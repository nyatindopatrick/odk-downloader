import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import axios from "axios";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

export async function POST(request: NextRequest) {
  let tempDir: string | undefined;
  
  try {
    // Check if we're in a serverless environment and /tmp is available
    const isServerless = process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const tempBaseDir = isServerless ? "/tmp" : path.join(process.cwd(), "public");
    
    console.log(`Environment: ${isServerless ? 'Serverless' : 'Local'}, Temp dir: ${tempBaseDir}`);
    
    // Set a reasonable timeout for the entire operation (8 seconds for Netlify, longer for local)
    const operationTimeout = isServerless ? 8000 : 30000;
    
    const formData = await request.formData();
    const file = formData.get("file");
    const username = formData.get("username");
    const password = formData.get("password");

    if (!file || !username || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await (file as File).arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse Excel file
    const workbook = XLSX.read(buffer, { type: "buffer" });
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
      return NextResponse.json({ error: 'Could not find "Photo Link" column in the Excel file' }, { status: 400 });
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
      return NextResponse.json({ error: "No valid photo URLs found in the Excel file" }, { status: 400 });
    }

    // Limit the number of photos for serverless platforms to prevent timeouts
    const maxPhotos = isServerless ? 100 : 500; // Increased from 30 to 100
    if (photoUrls.length > maxPhotos) {
      return NextResponse.json({ 
        error: `Too many photos (${photoUrls.length}). Maximum allowed is ${maxPhotos} for serverless deployment.`,
        suggestion: "Please split your Excel file into smaller batches of 100 photos or less.",
        alternatives: [
          "Split your Excel file into multiple files with 100 photos each",
          "Use the local development version for larger batches",
          "Contact support for custom deployment options"
        ]
      }, { status: 400 });
    }

    // Warn about potential timeout on serverless platforms
    if (isServerless && photoUrls.length > 50) {
      console.warn(`Warning: Processing ${photoUrls.length} photos may exceed serverless function timeout limits`);
    }

    // Create temporary directory for photos
    const timestamp = Date.now();
    tempDir = path.join(tempBaseDir, `photos_${timestamp}`);
    const zipDir = path.join(tempBaseDir, "downloads");

    // Ensure directories exist
    console.log(`Creating directories: ${tempDir}, ${zipDir}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(zipDir, { recursive: true });
    console.log('Directories created successfully');

    // Download photos with basic auth
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    console.log(`Starting download of ${photoUrls.length} photos...`);
    
    // Add timeout for downloads - adjust based on photo count
    const baseTimeout = isServerless ? 6000 : 25000; // Reduced base timeout for serverless
    const downloadTimeout = Math.min(baseTimeout - 2000, 20000); // Leave 2 seconds for zip creation
    
    // Process photos in smaller batches for better reliability
    const batchSize = isServerless ? 25 : 50;
    const batches = [];
    
    for (let i = 0; i < photoUrls.length; i += batchSize) {
      batches.push(photoUrls.slice(i, i + batchSize));
    }
    
    console.log(`Processing ${photoUrls.length} photos in ${batches.length} batches of ${batchSize}`);
    
    let allResults: any[] = [];
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} photos)`);
      
      const downloadPromises = batch.map(async (url, index) => {
        try {
          // Extract filename from URL or use index
          const urlParts = url.split("/");
          const filename = urlParts[urlParts.length - 1] || `photo_${batchIndex * batchSize + index + 1}.jpg`;

          const response = await axios({
            method: "GET",
            url: url,
            responseType: "stream",
            headers: {
              Authorization: `Basic ${auth}`,
            },
            timeout: downloadTimeout,
          });

          const filePath = path.join(tempDir!, filename);
          const writer = fs.createWriteStream(filePath);

          await pipeline(response.data, writer);
          return { success: true, filename };
        } catch (error: any) {
          console.error(`Failed to download ${url}:`, error.message);
          return { success: false, error: error.message };
        }
      });

      // Process each batch with timeout
      const batchResults = await Promise.race([
        Promise.all(downloadPromises),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Batch ${batchIndex + 1} download timeout`)), downloadTimeout)
        )
      ]) as any[];
      
      allResults = allResults.concat(batchResults);
      console.log(`Batch ${batchIndex + 1} completed: ${batchResults.filter((r: any) => r.success).length}/${batch.length} successful`);
    }
    
    const results = allResults;
    const successfulDownloads = results.filter((r) => r.success);
    
    console.log(`Download completed: ${successfulDownloads.length}/${photoUrls.length} successful`);

    if (successfulDownloads.length === 0) {
      // Cleanup temp directory
      if (tempDir) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
      return NextResponse.json({ error: "Failed to download any photos. Check your credentials." }, { status: 500 });
    }

    // Create zip file
    const zipFilename = `photos_${timestamp}.zip`;
    const zipPath = path.join(zipDir, zipFilename);
    console.log(`Creating zip file: ${zipPath}`);
    
    // Create zip file with proper promise handling and timeout
    const zipResult = await Promise.race([
      new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", async () => {
          try {
            // Delete temporary directory after zipping
            if (tempDir) {
              await fs.promises.rm(tempDir, { recursive: true, force: true });
            }
            console.log("Zip file created successfully and temp directory cleaned up");
            resolve(true);
          } catch (cleanupError) {
            console.error("Cleanup error:", cleanupError);
            // Don't fail the whole operation for cleanup errors
            resolve(true);
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
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Zip creation timeout")), operationTimeout - 1000)
      )
    ]);

    if (!zipResult) {
      throw new Error("Failed to create zip file");
    }

    // Schedule cleanup of zip file after 1 hour
    setTimeout(async () => {
      try {
        await fs.promises.unlink(zipPath);
        console.log("Zip file cleaned up after timeout");
      } catch (error) {
        console.error("Failed to cleanup zip file:", error);
      }
    }, 3600000);

    return NextResponse.json({
      success: true,
      photoCount: successfulDownloads.length,
      totalUrls: photoUrls.length,
      downloadUrl: `/api/download/${zipFilename}`,
    });
  } catch (error: any) {
    console.error("Error processing Excel file:", error);
    
    // Cleanup any temporary directories that might have been created
    try {
      if (typeof tempDir !== 'undefined') {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        console.log("Cleaned up temp directory on error");
      }
    } catch (cleanupError) {
      console.error("Failed to cleanup temp directory:", cleanupError);
    }
    
    // Ensure we always return valid JSON, even on errors
    const errorMessage = error.message || "Unknown error occurred";
    
    // Check if this is a timeout error
    if (errorMessage.includes("timeout")) {
      return NextResponse.json({ 
        error: "Operation timed out. Please try with fewer photos or contact support.",
        details: errorMessage 
      }, { status: 408 });
    }
    
    return NextResponse.json({ 
      error: "Failed to process Excel file: " + errorMessage 
    }, { status: 500 });
  }
}