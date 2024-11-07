const express = require('express');
const mongoose = require('mongoose');
const aws = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const axios = require('axios');
const authenticateJWT = require('./middleware/authenticateJWT');  // JWT Middleware
require('dotenv').config();

console.log("S3 Bucket Name:", process.env.AWS_S3_BUCKET_NAME);  // Log the S3 Bucket Name to verify it's loaded correctly

const userRoutes = require('./routes/userRoutes');
const fileRoutes = require('./routes/fileRoutes'); // Updated route for beats
const Beat = require('./models/beatModel');
const User = require('./models/userModel'); // Your Beat model for saving metadata

const app = express();
app.use(express.json());

// AWS S3 Configuration
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

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
  }),
  limits: { fileSize: 10 * 1024 * 1024 }  // Set file size limit to 10MB
});


// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected locally'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes for Users and Beats
app.use('/user', userRoutes);
app.use('/beats', authenticateJWT, fileRoutes); 

// New route for uploading beats to AWS S3
app.post('/beats/upload', authenticateJWT, upload.single('beat'), async (req, res) => {
  const { title, artist } = req.body;
  const fileUrl = req.file.location;

  const newBeat = new Beat({
    title: title,
    artist: artist,
    s3_url: fileUrl
  });

  try {
    const savedBeat = await newBeat.save();
    await axios.post('http://notification-service:5002/notify-upload', {
      artist: artist,
      beatTitle: title
    });

    res.status(201).json({ message: 'Beat uploaded successfully!', beat: savedBeat });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save beat metadata' });
  }
});

app.get('/status', (req, res) => {
  res.status(200).json({ status: 'UserFile Service is running' });
});


// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`UserFile Microservice running on port ${PORT}`);
});

