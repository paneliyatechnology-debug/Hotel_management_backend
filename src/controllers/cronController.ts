import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';

// Remove all PDF files from uploads/folios folder
export const cleanFolioPdfs = async (req?: Request, res?: Response): Promise<void> => {
  try {
    const foliosDir = path.join(process.cwd(), 'uploads', 'folios');

    if (!fs.existsSync(foliosDir)) {
      if (res) {
        res.status(200).json({ success: true, message: 'Uploads/folios folder does not exist', deletedFiles: 0 });
      }
      return;
    }

    const files = fs.readdirSync(foliosDir);
    let deletedFiles = 0;

    for (const file of files) {
      if (file.toLowerCase().endsWith('.pdf')) {
        const filePath = path.join(foliosDir, file);
        fs.unlinkSync(filePath);
        deletedFiles++;
      }
    }

    console.log(`🧹 [Cron] Removed ${deletedFiles} PDF file(s) from uploads/folios`);

    if (res) {
      res.status(200).json({
        success: true,
        message: `Successfully removed ${deletedFiles} PDF file(s) from uploads/folios`,
        deletedFiles,
      });
    }
  } catch (error: any) {
    console.error('❌ [Cron] Error removing folio PDFs:', error);
    if (res) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};
