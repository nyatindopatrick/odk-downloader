import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import axios from 'axios';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const router = express.Router();

// Configure multer for file upload
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.includes('spreadsheet') || 
        file.originalname.match(/\.(xlsx|xls)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  }
});

interface ProcessResult {
  success: boolean;
  filename?: string;
  error?: string;
}

router.post('/', upload.single('file'), async (req, res) => {
  let tempDir: string | undefined;
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const io = global.socketIO;
  
  // Helper function to emit progress updates
  const emitProgress = (stage: string, current: number, total: number, message: string) => {
    const progressData = {
      sessionId,
      stage,
      current,
      total,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
      message
    };
    io.to(`progress-${sessionId}`).emit('progress-update', progressData);
    console.log(`Progress: ${progressData.message} (${progressData.percentage}%)`);
  };
  
  try {
    const { username, password } = req.body;
    const file = req.file;

    if (!file || !username || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log(`Processing file: ${file.originalname}, size: ${file.size} bytes`);
    
    // Return session ID immediately so client can connect to progress updates
    res.json({
      success: true,
      sessionId,
      message: "Processing started. Connect to real-time updates using the sessionId."
    });
    
    emitProgress('parsing', 1, 5, 'Parsing Excel file...');

    // Parse Excel file
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with header option
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Find the "Photo Link" column
    const headerRow = jsonData[0] as any[];
    let photoLinkIndex = -1;

    for (let i = 0; i < headerRow.length; i++) {
      if (headerRow[i] && headerRow[i].toString().toLowerCase().includes("photo link")) {
        photoLinkIndex = i;
        break;
      }
    }

    if (photoLinkIndex === -1) {
      return res.status(400).json({ error: 'Could not find "Photo Link" column in the Excel file' });
    }

    // Extract photo URLs (skip header row)
    const photoUrls: string[] = [];
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i] as any[];
      const url = row[photoLinkIndex];
      if (url && typeof url === "string" && url.startsWith("http")) {
        photoUrls.push(url);
      }
    }

    if (photoUrls.length === 0) {
      emitProgress('error', 0, 0, 'No valid photo URLs found in the Excel file');
      return;
    }

    console.log(`Found ${photoUrls.length} photo URLs to download`);
    emitProgress('found-urls', 2, 5, `Found ${photoUrls.length} photo URLs to download`);

    // Create temporary directory for photos
    const timestamp = Date.now();
    tempDir = path.join(process.cwd(), 'temp', `photos_${timestamp}`);
    const zipDir = path.join(process.cwd(), 'downloads');

    // Ensure directories exist
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(zipDir, { recursive: true });
    
    emitProgress('setup', 3, 5, 'Setting up directories and authentication...');

    // Download photos with basic auth - no limits for Docker deployment
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    console.log(`Starting download of ${photoUrls.length} photos...`);
    
    emitProgress('downloading', 0, photoUrls.length, `Starting download of ${photoUrls.length} photos...`);
    
    // Process photos in batches for better memory management
    const batchSize = 50; // Increased from serverless constraints
    const batches = [];
    
    for (let i = 0; i < photoUrls.length; i += batchSize) {
      batches.push(photoUrls.slice(i, i + batchSize));
    }
    
    console.log(`Processing ${photoUrls.length} photos in ${batches.length} batches of ${batchSize}`);
    
    let allResults: ProcessResult[] = [];
    let completedPhotos = 0;
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} photos)`);
      
      emitProgress('downloading', completedPhotos, photoUrls.length, `Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} photos)`);
      
      const downloadPromises = batch.map(async (url, index): Promise<ProcessResult> => {
        try {
          // Extract filename from URL or use index
          const urlParts = url.split("/");
          let filename = urlParts[urlParts.length - 1] || `photo_${batchIndex * batchSize + index + 1}.jpg`;
          
          // Ensure filename has proper extension
          if (!filename.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) {
            filename += '.jpg';
          }

          const response = await axios({
            method: "GET",
            url: url,
            responseType: "stream",
            headers: {
              Authorization: `Basic ${auth}`,
            },
            timeout: 30000, // 30 second timeout per image
          });

          const filePath = path.join(tempDir!, filename);
          const writer = fs.createWriteStream(filePath);

          await pipeline(response.data, writer);
          completedPhotos++;
          
          // Update progress every few downloads to avoid too many events
          if (completedPhotos % 5 === 0 || completedPhotos === photoUrls.length) {
            emitProgress('downloading', completedPhotos, photoUrls.length, 
              `Downloaded ${completedPhotos}/${photoUrls.length} photos...`);
          }
          
          return { success: true, filename };
        } catch (error: any) {
          console.error(`Failed to download ${url}:`, error.message);
          completedPhotos++;
          return { success: false, error: error.message };
        }
      });

      const batchResults = await Promise.all(downloadPromises);
      allResults = allResults.concat(batchResults);
      
      const successfulInBatch = batchResults.filter(r => r.success).length;
      console.log(`Batch ${batchIndex + 1} completed: ${successfulInBatch}/${batch.length} successful`);
      
      emitProgress('downloading', completedPhotos, photoUrls.length, 
        `Batch ${batchIndex + 1}/${batches.length} completed: ${successfulInBatch}/${batch.length} successful`);
    }
    
    const results = allResults;
    const successfulDownloads = results.filter(r => r.success);
    
    console.log(`Download completed: ${successfulDownloads.length}/${photoUrls.length} successful`);
    
    emitProgress('completed-downloads', successfulDownloads.length, photoUrls.length, 
      `Download completed: ${successfulDownloads.length}/${photoUrls.length} successful`);

    if (successfulDownloads.length === 0) {
      // Cleanup temp directory
      if (tempDir) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
      emitProgress('error', 0, 0, 'Failed to download any photos. Check your credentials.');
      return;
    }

    // Create zip file
    const zipFilename = `photos_${timestamp}.zip`;
    const zipPath = path.join(zipDir, zipFilename);
    console.log(`Creating zip file: ${zipPath}`);
    
    emitProgress('zipping', 4, 5, 'Creating ZIP file...');
    
    // Create zip file
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", async () => {
        try {
          // Delete temporary directory after zipping
          if (tempDir) {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
          }
          console.log("Zip file created successfully and temp directory cleaned up");
          resolve();
        } catch (cleanupError) {
          console.error("Cleanup error:", cleanupError);
          // Don't fail the whole operation for cleanup errors
          resolve();
        }
      });

      output.on("error", (err) => {
        reject(new Error(`Failed to create zip file: ${err.message}`));
      });

      archive.on("error", (err) => {
        reject(new Error(`Archive error: ${err.message}`));
      });

      archive.pipe(output);
      archive.directory(tempDir!, false);
      archive.finalize();
    });

    // Schedule cleanup of zip file after 2 hours (Docker has more storage)
    setTimeout(async () => {
      try {
        await fs.promises.unlink(zipPath);
        console.log("Zip file cleaned up after timeout");
      } catch (error) {
        console.error("Failed to cleanup zip file:", error);
      }
    }, 2 * 60 * 60 * 1000); // 2 hours

    // Cleanup uploaded Excel file
    try {
      await fs.promises.unlink(file.path);
    } catch (cleanupError) {
      console.error("Failed to cleanup uploaded file:", cleanupError);
    }

    emitProgress('completed', 5, 5, 
      `Processing complete! ${successfulDownloads.length} photos ready for download.`);
    
    // Send final success status via Socket.IO
    const finalResult = {
      success: true,
      photoCount: successfulDownloads.length,
      totalUrls: photoUrls.length,
      downloadUrl: `/api/download/${zipFilename}`,
      failedDownloads: results.filter(r => !r.success).length
    };
    
    io.to(`progress-${sessionId}`).emit('process-complete', finalResult);

  } catch (error: any) {
    console.error("Error processing Excel file:", error);
    
    const errorMessage = error.message || "Unknown error occurred";
    emitProgress('error', 0, 0, `Failed to process Excel file: ${errorMessage}`);
    
    // Send error via Socket.IO
    io.to(`progress-${sessionId}`).emit('process-error', {
      error: `Failed to process Excel file: ${errorMessage}`
    });
    
    // Cleanup any temporary directories that might have been created
    try {
      if (tempDir) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        console.log("Cleaned up temp directory on error");
      }
    } catch (cleanupError) {
      console.error("Failed to cleanup temp directory:", cleanupError);
    }

    // Cleanup uploaded file
    if (req.file) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (cleanupError) {
        console.error("Failed to cleanup uploaded file:", cleanupError);
      }
    }
  }
});

export default router;