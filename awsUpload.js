const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');

// S3 설정
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// 업로드 설정
const uploadTMP = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'tmpraccon', // 버킷 이름
    key: function (req, file, cb) {
      cb(null, Date.now().toString()); // 파일명 설정
    }
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // 파일 크기 제한 (4MB)
});

// 모듈화 export
module.exports = uploadTMP;