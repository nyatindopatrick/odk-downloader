"use client";

import { useState } from "react";

interface Credentials {
  username: string;
  password: string;
}

interface FileUploaderProps {
  credentials: Credentials;
}

export default function FileUploader({ credentials }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [downloadLink, setDownloadLink] = useState("");
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.match(/\.(xlsx|xls)$/)) {
        setMessage("Please select a valid Excel file (.xlsx or .xls)");
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setMessage("");
      setDownloadLink("");
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage("Please select a file first");
      return;
    }

    setStatus("processing");
    setMessage("Processing Excel file...");
    setProgress(10);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("username", credentials.username);
    formData.append("password", credentials.password);

    try {
      const response = await fetch("/api/process-excel", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process file");
      }

      // Poll for progress
      setMessage(`Found ${data.photoCount} photos. Downloading and zipping...`);
      setProgress(30);

      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 1000);

      // Wait for the actual processing to complete
      setTimeout(() => {
        clearInterval(progressInterval);
        setProgress(100);
        setStatus("completed");
        setMessage(`Successfully processed ${data.photoCount} photos!`);
        setDownloadLink(data.downloadUrl);
      }, 5000);
    } catch (error: any) {
      setStatus("error");
      setMessage(`Error: ${error.message}`);
      setProgress(0);
    }
  };

  const handleReset = () => {
    setFile(null);
    setStatus("idle");
    setMessage("");
    setDownloadLink("");
    setProgress(0);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <h2 className="text-2xl font-semibold mb-6 text-gray-800">Upload Excel File</h2>

      <div className="space-y-6">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          <input
            type="file"
            onChange={handleFileChange}
            accept=".xlsx,.xls"
            className="hidden"
            id="file-input"
            disabled={status === "processing"}
          />
          <label htmlFor="file-input" className="cursor-pointer inline-block">
            <div className="space-y-2">
              <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="text-gray-600">
                {file ? (
                  <span className="font-medium text-blue-600">{file.name}</span>
                ) : (
                  <>
                    <span className="font-medium text-blue-600 hover:text-blue-500">Click to upload</span>
                    <span className="text-gray-500"> or drag and drop</span>
                  </>
                )}
              </div>
              <p className="text-xs text-gray-500">Excel files only (.xlsx, .xls)</p>
            </div>
          </label>
        </div>

        {status === "processing" && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Processing...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {message && (
          <div
            className={`p-4 rounded-md ${
              status === "error"
                ? "bg-red-50 text-red-800 border border-red-200"
                : status === "completed"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-blue-50 text-blue-800 border border-blue-200"
            }`}
          >
            {message}
          </div>
        )}

        {downloadLink && (
          <div className="p-4 bg-green-50 rounded-md border border-green-200">
            <p className="text-green-800 mb-3">Your photos are ready!</p>
            <a
              href={downloadLink}
              download
              className="inline-block px-6 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors font-medium"
            >
              Download ZIP File
            </a>
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={handleUpload}
            disabled={!file || status === "processing"}
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors ${
              !file || status === "processing"
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-500 text-white hover:bg-blue-600"
            }`}
          >
            {status === "processing" ? "Processing..." : "Process Excel File"}
          </button>

          {status === "completed" && (
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors font-medium"
            >
              Upload Another File
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
