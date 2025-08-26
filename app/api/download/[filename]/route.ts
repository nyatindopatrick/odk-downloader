import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params;

    // Validate filename to prevent directory traversal
    if (!filename || filename.includes("..") || !filename.endsWith(".zip")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Check if we're in a serverless environment and /tmp is available
    const isServerless = process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const tempBaseDir = isServerless ? "/tmp" : path.join(process.cwd(), "public");
    
    const filePath = path.join(tempBaseDir, "downloads", filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Read file
    const fileBuffer = await fs.promises.readFile(filePath);

    // Return file as response
    return new NextResponse(fileBuffer as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error downloading file:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}
