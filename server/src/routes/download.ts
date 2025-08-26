import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

router.get('/:filename', async (req: express.Request, res: express.Response) => {
  try {
    const { filename } = req.params;

    // Validate filename to prevent directory traversal
    if (!filename || filename.includes("..") || !filename.endsWith(".zip")) {
      return res.status(400).json({ error: "Invalid filename" });
    }

    const filePath = path.join(process.cwd(), "downloads", filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found or has expired" });
    }

    // Get file stats
    const stat = await fs.promises.stat(filePath);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size.toString());

    // Create read stream and pipe to response
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (err) => {
      console.error('Error reading file:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to read file" });
      }
    });

    fileStream.pipe(res);

  } catch (error: any) {
    console.error("Error downloading file:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to download file" });
    }
  }
});

export default router;