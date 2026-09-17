const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.POSTMAN_API_KEY || 'PMAK-6aa8e422ff39a60001ec8e0a-8ebf86344656f29e183c66a7d25bfd9f53';
const COLLECTION_UID = process.env.POSTMAN_COLLECTION_UID || '58032734-a3f834d5-0e89-4133-bae1-d3e2da8e2ab0';

const syncPostman = () => {
  const filePath = path.join(__dirname, '../../postman_collection.json');
  if (!fs.existsSync(filePath)) {
    console.error('postman_collection.json not found');
    return;
  }

  const collectionData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const payload = JSON.stringify({ collection: collectionData });

  const req = https.request(
    {
      hostname: 'api.getpostman.com',
      path: `/collections/${COLLECTION_UID}`,
      method: 'PUT',
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Postman Collection automatically synced to your Postman Software!');
        } else {
          console.error('❌ Postman sync failed:', body);
        }
      });
    }
  );

  req.on('error', (e) => {
    console.error('Postman Sync Request Error:', e.message);
  });

  req.write(payload);
  req.end();
};

syncPostman();
