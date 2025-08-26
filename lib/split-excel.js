const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * Helper script to split large Excel files into smaller batches
 * Usage: node lib/split-excel.js <input-file> <batch-size>
 * Example: node lib/split-excel.js photos.xlsx 100
 */

function splitExcelFile(inputFile, batchSize = 100) {
  try {
    // Read the Excel file
    const workbook = XLSX.readFile(inputFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (jsonData.length <= 1) {
      console.log('No data found in Excel file');
      return;
    }
    
    const headerRow = jsonData[0];
    const dataRows = jsonData.slice(1);
    const totalRows = dataRows.length;
    
    console.log(`Total rows: ${totalRows}`);
    console.log(`Batch size: ${batchSize}`);
    console.log(`Number of batches: ${Math.ceil(totalRows / batchSize)}`);
    
    // Create output directory
    const outputDir = 'split-excel-files';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    // Split into batches
    for (let i = 0; i < totalRows; i += batchSize) {
      const batchNumber = Math.floor(i / batchSize) + 1;
      const batchData = [headerRow, ...dataRows.slice(i, i + batchSize)];
      
      // Create new workbook
      const newWorkbook = XLSX.utils.book_new();
      const newWorksheet = XLSX.utils.aoa_to_sheet(batchData);
      XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Sheet1');
      
      // Generate filename
      const baseName = path.basename(inputFile, path.extname(inputFile));
      const outputFile = path.join(outputDir, `${baseName}_batch_${batchNumber}.xlsx`);
      
      // Write file
      XLSX.writeFile(newWorkbook, outputFile);
      console.log(`Created: ${outputFile} (${batchData.length - 1} rows)`);
    }
    
    console.log(`\nAll batches created in '${outputDir}' directory`);
    console.log('You can now process each batch file separately.');
    
  } catch (error) {
    console.error('Error splitting Excel file:', error.message);
  }
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: node lib/split-excel.js <input-file> [batch-size]');
  console.log('Example: node lib/split-excel.js photos.xlsx 100');
  process.exit(1);
}

const inputFile = args[0];
const batchSize = args[1] ? parseInt(args[1]) : 100;

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

splitExcelFile(inputFile, batchSize);
