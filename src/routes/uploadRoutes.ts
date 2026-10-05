import express, { Request, Response } from 'express';
import multer from 'multer';
import { uploadBufferToCloudinary, uploadToCloudinary } from '../utils/cloudinary';
import { authenticateUser } from '../middleware/authMiddleware';

const router = express.Router();

// Configure Multer with memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images and PDF documents
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WEBP) and PDF documents are allowed'));
    }
  },
});

// @desc    Upload Single File (Guest ID, Member Photo, Room Image, etc.) to Cloudinary
// @route   POST /api/v1/upload
// @access  Authenticated or Public Front-desk
router.post(
  '/',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const folder = (req.body.folder as string) || 'hotel_guest_documents';

      if (req.file) {
        const result = await uploadBufferToCloudinary(
          req.file.buffer,
          folder,
          req.file.originalname,
          req.file.mimetype
        );
        res.status(200).json({
          success: true,
          message: 'File uploaded successfully',
          url: result.url,
          secure_url: result.url,
          public_id: result.public_id,
          format: result.format,
          originalname: req.file.originalname,
          size: req.file.size,
        });
        return;
      }

      // Handle base64 fallback in request body
      if (req.body.base64 || req.body.image) {
        const base64Data = req.body.base64 || req.body.image;
        const liveUrl = await uploadToCloudinary(base64Data, folder);
        res.status(200).json({
          success: true,
          message: 'Base64 image uploaded successfully to Cloudinary',
          url: liveUrl,
          secure_url: liveUrl,
        });
        return;
      }

      res.status(400).json({
        success: false,
        message: 'No file or base64 image provided for upload.',
      });
    } catch (error: any) {
      console.error('❌ Upload Route Error:', error?.message || error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to upload file to Cloudinary',
      });
    }
  }
);

// @desc    Upload Multiple Files (e.g., Primary & Accompanying Member IDs)
// @route   POST /api/v1/upload/multiple
router.post(
  '/multiple',
  upload.array('files', 10),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const folder = (req.body.folder as string) || 'hotel_guest_documents';
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          message: 'No files provided for upload.',
        });
        return;
      }

      const uploadPromises = files.map((file) =>
        uploadBufferToCloudinary(file.buffer, folder, file.originalname)
      );

      const results = await Promise.all(uploadPromises);

      res.status(200).json({
        success: true,
        message: `${results.length} files uploaded successfully to Cloudinary`,
        files: results.map((r, idx) => ({
          url: r.url,
          secure_url: r.url,
          public_id: r.public_id,
          originalname: files[idx].originalname,
        })),
        urls: results.map((r) => r.url),
      });
    } catch (error: any) {
      console.error('❌ Multiple Upload Error:', error?.message || error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to upload multiple files',
      });
    }
  }
);

export default router;
