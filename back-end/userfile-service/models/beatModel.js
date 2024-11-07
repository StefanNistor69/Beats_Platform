const mongoose = require('mongoose');

const beatSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  s3_url: { type: String, required: true }, // The S3 URL of the file
  uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Beat', beatSchema);
