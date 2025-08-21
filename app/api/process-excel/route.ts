import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import axios from "axios";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

export async function POST(request: NextRequest) {
  try {
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

    // Create temporary directory for photos
    const timestamp = Date.now();
    const tempDir = path.join(process.cwd(), "public", "temp", `photos_${timestamp}`);
    const zipDir = path.join(process.cwd(), "public", "downloads");

    // Ensure directories exist
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(zipDir, { recursive: true });

    // Download photos with basic auth
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const downloadPromises = photoUrls.map(async (url, index) => {
      try {
        // Extract filename from URL or use index
        const urlParts = url.split("/");
        const filename = urlParts[urlParts.length - 1] || `photo_${index + 1}.jpg`;

        const response = await axios({
          method: "GET",
          url: url,
          responseType: "stream",
          headers: {
            Authorization: `Basic ${auth}`,
          },
          timeout: 30000,
        });

        const filePath = path.join(tempDir, filename);
        const writer = fs.createWriteStream(filePath);

        await pipeline(response.data, writer);
        return { success: true, filename };
      } catch (error: any) {
        console.error(`Failed to download ${url}:`, error.message);
        return { success: false, error: error.message };
      }
    });

    const results = await Promise.all(downloadPromises);
    const successfulDownloads = results.filter((r) => r.success);

    if (successfulDownloads.length === 0) {
      // Cleanup temp directory
      await fs.promises.rmdir(tempDir, { recursive: true });
      return NextResponse.json({ error: "Failed to download any photos. Check your credentials." }, { status: 500 });
    }

    // Create zip file
    const zipFilename = `photos_${timestamp}.zip`;
    const zipPath = path.join(zipDir, zipFilename);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", async () => {
      // Delete temporary directory after zipping
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    archive.on("error", (err: any) => {
      throw err;
    });

    archive.pipe(output);
    archive.directory(tempDir, false);
    await archive.finalize();

    // Schedule cleanup of zip file after 1 hour
    setTimeout(async () => {
      try {
        await fs.promises.unlink(zipPath);
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
    return NextResponse.json({ error: "Failed to process Excel file: " + error.message }, { status: 500 });
  }
}
