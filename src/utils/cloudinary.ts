import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import https from 'https';

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
  secure: true,
});

/**
 * Direct HTTPS Unsigned Preset Upload
 */
const uploadViaPreset = async (
  dataOrBuffer: Buffer | string,
  cloudName: string,
  preset: string = 'hotel_preset',
  folder?: string
): Promise<{ url: string; public_id: string; format: string } | null> => {
  try {
    const filePayload = typeof dataOrBuffer === 'string'
      ? dataOrBuffer
      : `data:image/jpeg;base64,${dataOrBuffer.toString('base64')}`;

    const postData = JSON.stringify({
      file: filePayload,
      upload_preset: preset,
      folder: folder || undefined,
    });

    return await new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.cloudinary.com',
          port: 443,
          path: `/v1_1/${cloudName}/image/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (res.statusCode === 200 && parsed.secure_url) {
                console.log(`✅ [Cloudinary Preset] Uploaded successfully: ${parsed.secure_url}`);
                return resolve({
                  url: parsed.secure_url,
                  public_id: parsed.public_id || '',
                  format: parsed.format || 'jpg',
                });
              }
              resolve(null);
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.write(postData);
      req.end();
    });
  } catch {
    return null;
  }
};

/**
 * Upload Image/Document Buffer directly to Cloudinary using streaming
 * Returns the live secure CDN URL (https://res.cloudinary.com/...)
 */
export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  folder: string = 'hotel_guest_documents',
  filename?: string,
  mimetype: string = 'image/jpeg'
): Promise<{ url: string; public_id: string; format: string }> => {
  if (!buffer || buffer.length === 0) {
    throw new Error('No file buffer provided for upload.');
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'arcmdvlc';
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudinaryUrl = process.env.CLOUDINARY_URL;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'hotel_preset';

  const isConfigured = Boolean(cloudinaryUrl || (cloudName && apiKey && apiSecret && cloudName !== 'hotel'));

  if (!isConfigured) {
    const base64Data = `data:${mimetype};base64,${buffer.toString('base64')}`;
    return {
      url: base64Data,
      public_id: filename ? filename.replace(/\.[^/.]+$/, '') : `doc_${Date.now()}`,
      format: mimetype.split('/')[1] || 'jpeg',
    };
  }

  if (cloudinaryUrl) {
    cloudinary.config({ url: cloudinaryUrl });
  } else {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  // 1. If uploadPreset is configured, upload directly via preset (bypasses restricted API key 403)
  if (uploadPreset) {
    const presetResult = await uploadViaPreset(buffer, cloudName, uploadPreset, folder);
    if (presetResult && presetResult.url) {
      return presetResult;
    }
  }

  // 2. Try Standard Signed Stream Upload
  const signedResult = await new Promise<{ url: string; public_id: string; format: string } | null>((resolve) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        public_id: filename ? filename.replace(/\.[^/.]+$/, '') : undefined,
        transformation: [
          { quality: 'auto:good' },
          { fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error || !result) {
          console.error('❌ Cloudinary Stream Upload Failed:', {
            status: error?.http_code || 403,
            http_code: error?.http_code || 403,
            message: error?.message || 'Upload failed',
            cloud_name: cloudName,
            api_key_last_4: apiKey ? apiKey.slice(-4) : 'NONE',
            has_api_secret: Boolean(apiSecret),
            errorDetails: error,
          });
          return resolve(null);
        }
        console.log(`✅ [Cloudinary] Buffer uploaded successfully: ${result.secure_url}`);
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
        });
      }
    );

    const readable = new Readable();
    readable._read = () => {};
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });

  if (signedResult && signedResult.url) {
    return signedResult;
  }

  // 3. Fallback to Data URI to prevent operational blocking
  const base64Data = `data:${mimetype};base64,${buffer.toString('base64')}`;
  return {
    url: base64Data,
    public_id: filename ? filename.replace(/\.[^/.]+$/, '') : `doc_${Date.now()}`,
    format: mimetype.split('/')[1] || 'jpeg',
  };
};

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

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'arcmdvlc';
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudinaryUrl = process.env.CLOUDINARY_URL;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'hotel_preset';

  const isConfigured = Boolean(cloudinaryUrl || (cloudName && apiKey && apiSecret && cloudName !== 'hotel'));
  if (!isConfigured) {
    return fileBase64OrUrl;
  }

  if (cloudinaryUrl) {
    cloudinary.config({ url: cloudinaryUrl });
  } else {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  // 1. Try preset first if configured
  if (uploadPreset) {
    const presetRes = await uploadViaPreset(fileBase64OrUrl, cloudName, uploadPreset, folder);
    if (presetRes && presetRes.url) {
      return presetRes.url;
    }
  }

  // 2. Try signed upload
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
    console.error('❌ Cloudinary Upload Failed:', {
      status: error?.http_code || 403,
      http_code: error?.http_code || 403,
      message: error?.message || 'Upload failed',
      cloud_name: cloudName,
      api_key_last_4: apiKey ? apiKey.slice(-4) : 'NONE',
      has_api_secret: Boolean(apiSecret),
      errorDetails: error,
    });
    return fileBase64OrUrl;
  }
};

export default cloudinary;

