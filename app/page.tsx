'use client';

import { useState } from 'react';
import LoginForm from './components/LoginForm';
import FileUploader from './components/FileUploader';

export default function Home() {
  const [credentials, setCredentials] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleLogin = (username, password) => {
    setCredentials({ username, password });
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    setCredentials(null);
    setIsLoggedIn(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">
          Photo Downloader & Zipper
        </h1>
        
        {!isLoggedIn ? (
          <LoginForm onLogin={handleLogin} />
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow-md p-4 flex justify-between items-center">
              <span className="text-gray-600">
                Logged in as: <span className="font-semibold">{credentials.username}</span>
              </span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Logout
              </button>
            </div>
            <FileUploader credentials={credentials} />
          </div>
        )}
      </div>
    </main>
  );
}