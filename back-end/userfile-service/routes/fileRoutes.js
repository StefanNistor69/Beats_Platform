const express = require('express');
const Beat = require('../models/beatModel'); // Import the Beat model
const multer = require('multer');
const multerS3 = require('multer-s3');
const aws = require('aws-sdk');

// AWS S3 Configuration
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Middleware to authenticate JWT
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403); // Forbidden
      }

      req.user = user; // Attach user info to the request object
      next();
    });
  } else {
    res.sendStatus(401); // Unauthorized
  }
};

module.exports = authenticateJWT;


// Multer setup for uploading files to AWS S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      cb(null, Date.now().toString() + '-' + file.originalname);  // Unique filename
    }
  })
});

const router = express.Router();

// Beat upload (file to S3 and metadata to MongoDB)
router.post('/upload', upload.single('beat'), async (req, res) => {
  const { title, artist } = req.body;  // Get metadata from request body
  const fileUrl = req.file.location;   // S3 URL of the uploaded file

  // Save beat metadata to MongoDB
  const newBeat = new Beat({
    title: title,
    artist: artist,
    s3_url: fileUrl
  });

  try {
    const savedBeat = await newBeat.save();
    res.status(201).json({
      message: 'Beat uploaded successfully!',
      beat: savedBeat
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save beat metadata' });
  }
});

module.exports = router;
