import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
  secure: true,
});

/**
 * Upload Base64 Data URI or Image Buffer to Cloudinary
 * Returns the live secure CDN URL (https://res.cloudinary.com/...)
 */
export const uploadToCloudinary = async (
  fileBase64OrUrl: string,
  folder: string = 'hotel_guest_documents'
): Promise<string> => {
  if (!fileBase64OrUrl) return '';

  // If already a live web/Cloudinary URL, return as is
  if (fileBase64OrUrl.startsWith('http://') || fileBase64OrUrl.startsWith('https://')) {
    return fileBase64OrUrl;
  }

  // Check if Cloudinary credentials are provided
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudinaryUrl = process.env.CLOUDINARY_URL;

  if (cloudinaryUrl) {
    cloudinary.config({ url: cloudinaryUrl });
  } else if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  } else {
    console.warn('⚠️ Cloudinary credentials missing in backend/.env.');
    return fileBase64OrUrl;
  }

  try {
    const uploadResponse = await cloudinary.uploader.upload(fileBase64OrUrl, {
      folder,
      resource_type: 'auto',
      transformation: [
        { quality: 'auto:good' },
        { fetch_format: 'auto' },
      ],
    });
    console.log(`✅ [Cloudinary] Uploaded successfully: ${uploadResponse.secure_url}`);
    return uploadResponse.secure_url;
  } catch (error: any) {
    console.error('❌ Cloudinary Upload Error:', error?.message || error);
    return fileBase64OrUrl; // Fallback gracefully if API error
  }
};

export default cloudinary;
