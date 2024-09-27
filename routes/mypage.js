const router = require('express').Router();
const { checkAuth } = require('../server.js'); // 미들웨어 불러오기
const { MongoClient, ObjectId } = require('mongodb');

let connectDB = require('../database.js');
let uploadTMP = require('../awsUpload');
let db;

connectDB.then(client => {
    //console.log('배틀 라우터 DB 연결 성공');  //확인완료
    db = client.db('pokemon');
}).catch(err => {
    console.log(err);
});

//라우터 시작
/**
 * @swagger
 * /mypage:
 *   get:
 *     summary: Retrieves the user's profile page
 *     tags: [mypage,Page]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's profile page rendered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   description: User's profile data
 */
router.get('/mypage', checkAuth, async (req, res) => {
  console.log(req.user);
  const userId = req.user._id;
  const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });
  
  user.purchase = user.purchase || [];
  user.point = user.point || 0;
  user.currentIcon = user.currentIcon || '';

  res.render('mypage.ejs', { user: user });
});

/**
* @swagger
* /purchase-icon:
*   post:
*     summary: Purchase an icon
*     tags: [mypage]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             properties:
*               iconName:
*                 type: string
*                 description: The name of the icon to purchase
*               iconCost:
*                 type: number
*                 description: The cost of the icon in points
*     responses:
*       200:
*         description: Successfully purchased the icon
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 success:
*                   type: boolean
*       400:
*         description: Bad request (insufficient points or already purchased)
*       404:
*         description: User not found
*       500:
*         description: Server error
*/
router.post('/purchase-icon', async (req, res) => {
  const { iconName, iconCost } = req.body;
  const userId = req.user._id;

  try {
      const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });

      if (!user) {
          return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
      }

      const updatedPurchase = user.purchase || [];

      if (updatedPurchase.includes(iconName)) {
          return res.status(400).json({ success: false, message: '이미 구매한 아이콘입니다.' });
      }

      if (user.point < iconCost) {
          return res.status(400).json({ success: false, message: '포인트가 부족합니다.' });
      }

      updatedPurchase.push(iconName);
      let cPoint = user.point - iconCost;

      await db.collection('user').updateOne(
          { _id: new ObjectId(userId) },
          {
              $set: {
                  point: cPoint,
                  purchase: updatedPurchase
              }
          }
      );
      res.json({ success: true });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, message: '구매 처리 중 오류 발생' });
  }
});

/**
* @swagger
* /update-icon:
*   post:
*     summary: Updates the user's current icon
*     tags: [mypage]
*     security:
*       - bearerAuth: []
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             properties:
*               icon:
*                 type: string
*                 description: The name of the icon to set as current
*     responses:
*       200:
*         description: Icon successfully updated
*       400:
*         description: Icon not owned or bad request
*       404:
*         description: User not found
*       500:
*         description: Server error
*/
router.post('/update-icon', checkAuth, async (req, res) => {
  const userId = req.user._id;
  const { icon } = req.body;

  try {
      const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });

      if (!user) {
          return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
      }

      if (!user.purchase.includes(icon)) {
          return res.status(400).json({ success: false, message: '아이콘을 구매하세여' });
      }

      await db.collection('user').updateOne(
          { _id: new ObjectId(userId) },
          { $set: { currentIcon: icon } }
      );

      res.json({ success: true });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, message: '아이콘 변경 중 오류가 발생했습니다.' });
  }
});

/**
* @swagger
* /update-nickname:
*   post:
*     summary: Updates the user's nickname
*     tags: [mypage]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             properties:
*               nickname:
*                 type: string
*                 description: The new nickname (2-8 characters)
*     responses:
*       200:
*         description: Nickname successfully updated
*       400:
*         description: Invalid nickname length or nickname already in use
*       500:
*         description: Server error
*/
router.post('/update-nickname', async (req, res) => {
  const userId = req.user._id;
  const nickname = req.body.nickname;

  if (nickname.length > 8 || nickname.length < 2) {
      return res.status(400).json({ success: false, message: '닉네임 길이가 이상한데요' });
  } else if (await db.collection('user').findOne({ nickname: nickname }) != null) {
      return res.status(400).json({ success: false, message: '닉네임이 중복이네요' });
  }

  try {
      await db.collection('user').updateOne(
          { _id: new ObjectId(userId) },
          { $set: { nickname: nickname } }
      );
      res.json({ success: true });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, message: '닉네임 변경 중 오류 발생' });
  }
});

/**
* @swagger
* /upload-icon:
*   post:
*     summary: Uploads and updates the user's profile picture (icon)
*     tags: [mypage]
*     security:
*       - bearerAuth: []
*     requestBody:
*       required: true
*       content:
*         multipart/form-data:
*           schema:
*             type: object
*             properties:
*               image:
*                 type: string
*                 format: binary
*                 description: The image file to upload
*     responses:
*       200:
*         description: Image uploaded successfully
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 success:
*                   type: boolean
*                 url:
*                   type: string
*                   description: URL of the uploaded image
*       400:
*         description: Image upload failed
*       500:
*         description: Server error during image upload
*/
router.post('/upload-icon', uploadTMP.single('image'), async (req, res) => {
  const userId = req.user._id;

  if (!req.file || !req.file.location) {
      return res.status(400).send('이미지 업로드 실패');
  }

  const iconUrl = req.file.location;

  try {
      await db.collection('user').updateOne(
          { _id: new ObjectId(userId) },
          { $set: { icon: iconUrl } }
      );
      res.json({ success: true, url: iconUrl });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, message: '아이콘 업데이트 중 오류 발생' });
  }
});

/**
* @swagger
* /byebyebye:
*   post:
*     summary: User account deletion
*     tags: [mypage]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             properties:
*               password:
*                 type: string
*                 description: User's password for confirmation
*     responses:
*       200:
*         description: Account deleted successfully
*       400:
*         description: Incorrect password
*       500:
*         description: Server error during account deletion
*/
router.post('/byebyebye', async (req, res) => {
  const userId = req.user._id;
  const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });

  if (user.password === await bcrypt.hash(req.body.password, 10)) {
      await db.collection('user').deleteOne({ _id: new ObjectId(userId) });
      res.json({ success: true });
  } else {
      return res.status(400).json({ success: false, message: '비밀번호가 일치하지 않아요...' });
  }
});

module.exports = router;