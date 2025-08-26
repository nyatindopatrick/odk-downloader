import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { io, Socket } from "socket.io-client";

interface Credentials {
  username: string;
  password: string;
}

interface FileUploaderProps {
  credentials: Credentials;
}

interface ProgressData {
  sessionId: string;
  stage: string;
  current: number;
  total: number;
  percentage: number;
  message: string;
}

// API calls will go through nginx proxy in production
const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

export default function FileUploader({ credentials }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [downloadLink, setDownloadLink] = useState("");
  const [progress, setProgress] = useState(0);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Setup Socket.IO connection
  useEffect(() => {
    return () => {
      // Cleanup socket connection on unmount
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Handle real-time progress updates
  const setupProgressListener = (newSessionId: string) => {
    // Disconnect existing socket if any
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    // Create new socket connection
    const socketUrl = import.meta.env.PROD ? window.location.origin : API_BASE_URL;
    socketRef.current = io(socketUrl);

    socketRef.current.on('connect', () => {
      console.log('Connected to Socket.IO server');
      // Join the progress room for this session
      socketRef.current!.emit('join-progress', newSessionId);
    });

    socketRef.current.on('progress-update', (progressData: ProgressData) => {
      console.log('Progress update:', progressData);
      setProgress(progressData.percentage);
      setMessage(progressData.message);
    });

    socketRef.current.on('process-complete', (result: any) => {
      console.log('Process complete:', result);
      setStatus("completed");
      setProgress(100);
      setMessage(`Successfully processed ${result.photoCount} photos out of ${result.totalUrls} total URLs!`);
      // In production (Docker), use relative URL through nginx proxy
      const downloadUrl = import.meta.env.PROD ? result.downloadUrl : `${API_BASE_URL}${result.downloadUrl}`;
      setDownloadLink(downloadUrl);
      
      // Disconnect socket as processing is complete
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    });

    socketRef.current.on('process-error', (errorData: any) => {
      console.error('Process error:', errorData);
      setStatus("error");
      setMessage(`Error: ${errorData.error}`);
      setProgress(0);
      
      // Disconnect socket on error
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from Socket.IO server');
    });
  };

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
    setMessage("Uploading file and starting processing...");
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("username", credentials.username);
    formData.append("password", credentials.password);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/process-excel`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const uploadProgress = Math.round((progressEvent.loaded * 20) / progressEvent.total);
            setProgress(uploadProgress);
            setMessage(`Uploading file... ${uploadProgress}%`);
          }
        },
      });

      const data = response.data;

      if (data.success && data.sessionId) {
        setCurrentSessionId(data.sessionId);
        setMessage("File uploaded successfully. Starting real-time processing...");
        
        // Setup Socket.IO to listen for real-time progress updates
        setupProgressListener(data.sessionId);
      } else {
        throw new Error(data.error || "Failed to start processing");
      }

    } catch (error: any) {
      setStatus("error");
      const errorMessage = error.response?.data?.error || error.message || "Failed to process file";
      setMessage(`Error: ${errorMessage}`);
      
      if (error.response?.data?.suggestion) {
        setMessage((prev) => `${prev}\n\nSuggestion: ${error.response.data.suggestion}`);
      }
      
      if (error.response?.data?.alternatives) {
        const alternatives = error.response.data.alternatives.join("\n• ");
        setMessage((prev) => `${prev}\n\nAlternatives:\n• ${alternatives}`);
      }
      
      setProgress(0);
    }
  };

  const handleReset = () => {
    setFile(null);
    setStatus("idle");
    setMessage("");
    setDownloadLink("");
    setProgress(0);
    setCurrentSessionId(null);
    
    // Disconnect socket if connected
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
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
            className={`p-4 rounded-md whitespace-pre-line ${
              status === "error"
                ? "bg-red-50 text-red-800 border border-red-200"
                : status === "completed"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-blue-50 text-blue-800 border border-blue-200"
            }`}
          >
            {message}
            {currentSessionId && (
              <div className="text-xs mt-2 opacity-70">
                Session: {currentSessionId}
              </div>
            )}
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