const express = require('express');
const path = require('path');
const app = express();

const { MongoClient, ObjectId } = require('mongodb');
const methodOverride = require('method-override');
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo');
require('dotenv').config();
const { S3Client, DeleteObjectCommand  } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');

const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local');

//실시간 통신 소켓 관련
const { createServer } = require('http'); //이 모듈을 사용하는 라우트 불러오기 위에 먼저 적어야 함 (상호참조는 되는데 이런거 주의)
const { Server } = require('socket.io');
const server = createServer(app);
const io = new Server(server);

//리액트와 nodejs ajax 요청 관련
var cors = require('cors');
app.use(cors());

//const url = process.env.DB_URL;
let connectDB = require('./database.js');
let uploadTMP = require('./awsUpload'); // AWS S3 업로드 모듈 가져오기

const { time } = require('console');
let db;

//swagger (api 정리, 시각화용)
const { swaggerUi, specs } = require("./swaggerOptions"); // 설정 가져오기
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));


const s3 = new S3Client({
  region: 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_KEY,
    secretAccessKey: process.env.AWS_SECRET
  }
});

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'raccoonspring1',
    key: function (req, file, cb) {
      cb(null, Date.now().toString());
    }
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
});


app.use(methodOverride('_method'));

app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// '/'로 접속하면 일반 public 폴더(현재 디렉토리), '/react' 로 접속하면 react/build의 디렉토리
app.use('/', express.static( path.join(__dirname, 'public') ));
// app.use('/react', express.static( path.join(__dirname, 'react-app/build') ));

//app.use(express.static(path.join(__dirname, 'react-app/build')));   //리액트가 전체 라우팅 담당할때만 쓰셈

const sessionMiddleware = session({
  secret: '1234', //암호화 비번인데 지금은 안쓸거임
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 1000 * 60 * 24 * 30 }, //60초 -> 60분 -> 24시간 -> 30일
  store: MongoStore.create({
    mongoUrl: process.env.DB_URL,
    dbName: 'pokemon'
  })
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(async (email, password, done) => {
  let user = await db.collection('user').findOne({ email: email });
  if (!user) {
    return done(null, false, { message: '이메일 DB에 없음' });
  }
  if (await bcrypt.compare(password, user.password)) {
    return done(null, user);
  } else {
    return done(null, false, { message: '비번불일치' });
  }
}));

passport.serializeUser((user, done) => {
  process.nextTick(() => {
    done(null, { id: user._id, username: user.username });
  });
});

passport.deserializeUser(async (user, done) => {
  let currentUser = await db.collection('user').findOne({ _id: new ObjectId(user.id) });
  delete currentUser.password;
  process.nextTick(() => {
    done(null, currentUser);
  });
});

io.engine.use(sessionMiddleware);


// 세팅 끝

//미들웨어 => 사실 미들웨어도 middlewares.js 파일로 분리하는 편이 관리가 편하다고 함 시간나면 그렇게 하기

function checkAuth(req,res,next){ //로그인이 필요한 곳에 가져다 쓰는 미들웨어 / 로그아웃 상태일 시 /login으로 redirect
  if(req.isAuthenticated()) {
    return next();
  }
  else{
    res.redirect('/login');
  }
}

function checkAdmin(req,res,next){ //관리자 권한(admin) 필요한 곳에 가져다 쓰는 미들웨어
  if(!req.isAuthenticated()) {  //로그인 여부부터 확인
    res.redirect('/login');
  }

  if(req.user.rank=='admin') {   //그 다음 관리자 확인
    return next();
  }
  else{
    res.redirect('/home');
  }
}

function checkGuest(req,res,next){ //로그인 상태일 시 '/'으로 redirect
  if(req.isAuthenticated()) {
    return res.redirect('/');
  }
  next();
}

// '/list' 경로로 들어오는 요청에 대한 미들웨어
app.use('/list', (req, res, next) => {  
  //console.log(new Date());
  next(); //다음 단계 실행(없으면 미들웨어단계에서 끝남)
});

//모든 경로에 대해서 로그인 여부 확인하는 미들웨어()
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

module.exports = { checkAuth, checkGuest, io ,};   //미들웨어 exports는 파일당 한번만

//미들웨어 끝   ---------------------------------

//라우팅        ---------------------------------

//분리한 라우터 파일들 사용  
//'/'경로에 대해 아래 파일들에서 정의된 경로도 사용한다는 뜻
app.use('/', require('./routes/forum.js')) 
app.use('/', require('./routes/battle.js'))
app.use('/', require('./routes/mypage.js'))

/**
 * @swagger
 * /:
 *   get:
 *     summary: 홈 페이지 렌더링
 *     description: 최신 글 5개를 가져와 홈 페이지에 표시함
 *     tags:
 *       - Home
 *     responses:
 *       200:
 *         description: 성공
 *       500:
 *         description: 서버 오류
 * @param {object} req - 요청 객체
 * @param {object} res - 응답 객체
 */
app.get(['/', '/home'], async (req, res) => {
  try {
    // 최신 5개 글 가져오기
    let recentPosts = await db.collection('general forum')
        .find({}, {
            projection: {
                title: 1,
                _id: 1 // 필요한 필드만 포함
            }
        })
        .sort({ _id: -1 }) // 최신 글 순으로 정렬
        .limit(5) // 5개의 글만 가져오기
        .toArray();

    // home.ejs로 데이터 전달
    res.render('home.ejs', { recentPosts: recentPosts });
  } 
  catch (error) {
    console.error('홈 화면 로드 중 오류 발생:', error);
    res.status(500).send('서버 오류');
  }
});

/**
 * @swagger
 * /update:
 *   get:
 *     summary: 업데이트 페이지 렌더링
 *     description: 최신 업데이트 내용을 보여줍니다.
 *     tags:
 *       - Update
 *     responses:
 *       200:
 *         description: 성공
 */
app.get('/update', async (req, res) => {
  res.render('update.ejs');
});

/**
 * @swagger
 * /login:
 *   get:
 *     summary: 로그인 페이지 렌더링
 *     description: 로그인 페이지를 표시합니다. 사용자가 이미 로그인했으면 홈 페이지로 리다이렉트됩니다.
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: 성공
 *       302:
 *         description: 이미 로그인한 사용자
 */
app.get('/login', checkGuest, (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/');
  }
  res.render('login.ejs');
});

/**
 * @swagger
 * /login:
 *   post:
 *     summary: 사용자 로그인 처리
 *     description: 사용자의 이메일과 비밀번호로 로그인을 처리합니다.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: body
 *         name: 사용자 정보
 *         description: 이메일과 비밀번호를 입력합니다.
 *         schema:
 *           type: object
 *           required:
 *             - email
 *             - password
 *           properties:
 *             email:
 *               type: string
 *             password:
 *               type: string
 *     responses:
 *       200:
 *         description: 로그인 성공
 *       401:
 *         description: 로그인 실패
 */
app.post('/login', async (요청, 응답, next) => {
  passport.authenticate('local', (error, user, info) => {
    if (error) return 응답.status(500).json(error);
    if (!user) return 응답.status(401).json(info.message);
    요청.logIn(user, (err) => {
      if (err) return next(err);
      응답.redirect('/');
    });
  })(요청, 응답, next);
});

/**
 * @swagger
 * /logout:
 *   get:
 *     summary: 사용자 로그아웃
 *     description: 사용자를 로그아웃하고 홈 페이지로 리다이렉트합니다.
 *     tags:
 *       - Auth
 *     responses:
 *       302:
 *         description: 로그아웃 성공 후 홈으로 리다이렉트
 */
app.get('/logout', function (req, res, next) {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect('/');
  });
});

/**
 * @swagger
 * /register:
 *   get:
 *     summary: 회원가입 페이지 렌더링
 *     description: 사용자에게 회원가입 페이지를 보여줍니다.
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: 성공
 */
app.get('/register', checkGuest, (req, res) => {
  let msg = '당장 이 문서에 서명하시오';
  if (req.query.msg == 'nickname') {
    msg = '닉네임이 중복이거나 잘못된 전송이네요';
  } else if (req.query.msg == 'password') {
    msg = '비번으로 그런거 하지 마세요';
  } else if (req.query.msg == 'email') {
    msg = '이메일이 중복이네요';
  }
  res.render('register.ejs', { msg: msg });
});

/**
 * @swagger
 * /register:
 *   post:
 *     summary: 사용자 회원가입 처리
 *     description: 사용자의 정보를 받아 회원가입을 처리합니다.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: body
 *         name: 사용자 정보
 *         description: 회원가입에 필요한 정보 (이메일, 닉네임, 비밀번호)
 *         schema:
 *           type: object
 *           required:
 *             - email
 *             - nickname
 *             - password
 *           properties:
 *             email:
 *               type: string
 *             nickname:
 *               type: string
 *             password:
 *               type: string
 *     responses:
 *       200:
 *         description: 회원가입 성공 후 로그인 페이지로 리다이렉트
 *       400:
 *         description: 유효성 검사 실패
 */
app.post('/register', async (req, res) => {
  let email = req.body.email;
  let nickname = req.body.nickname;
  let password = await bcrypt.hash(req.body.password, 10);

  if (nickname.length < 2) {
    res.redirect('/register?msg=nickname');
    return;
  } else if (password.length < 3) {
    res.redirect('/register?msg=password');
    return;
  }

  if (await db.collection('user').findOne({ email: email }) != null) {
    res.redirect('/register?msg=email');
    return;
  } else if (await db.collection('user').findOne({ nickname: nickname }) != null) {
    res.redirect('/register?msg=nickname');
    return;
  }

  await db.collection('user').insertOne({
    email: email,
    nickname: nickname,
    password: password,
    rank: 'normal',
    icon: '/image/램프라.jpg',
    point: 10,
    time: new Date(),
  });

  res.redirect('/login');
});

/**
 * @swagger
 * /report:
 *   get:
 *     summary: 제보 작성 페이지 렌더링
 *     description: 제보 작성 페이지를 보여줍니다.
 *     tags:
 *       - Report
 *     responses:
 *       200:
 *         description: 성공
 */
app.get('/report', checkAuth, (req, res) => {
  res.render('writeReport.ejs');
});

/**
 * @swagger
 * /admin-report:
 *   get:
 *     summary: 관리자 제보 확인 페이지
 *     description: 관리자가 제보를 확인할 수 있는 페이지를 렌더링합니다.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: 성공
 *       500:
 *         description: 서버 오류
 */
app.get('/admin-report', checkAdmin, async (req, res) => {
  let reports = [];
  try {
    reports = await db.collection('report').find().toArray();
  } catch (error) {
    console.error('제보 데이터 가져오는 중 오류:', error);
    res.status(500).send('서버 오류');
  }
  res.render('adminReport', { reports });
});

/**
 * @swagger
 * /delete-report:
 *   delete:
 *     summary: 제보 삭제
 *     description: 관리자가 특정 제보를 삭제합니다.
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: body
 *         name: id
 *         description: 삭제할 제보의 ID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 성공적으로 삭제
 *       500:
 *         description: 서버 오류
 */
app.delete('/delete-report', checkAdmin, async (req, res) => {
  const reportId = req.body.id;
  try {
    await db.collection('report').deleteOne({ _id: new ObjectId(reportId) });
    res.json({ success: true });
  } catch {
    res.status(500).send('서버 오류');
  }
});




// //리액트 라우터
// app.get('/react', function (req, res) {  
//   res.sendFile(path.join(__dirname, '/react-app/build/index.html'));
// });
// // 리액트 서브 라우팅 / '/react/*~~~~'로 들어오는 모든 주소 라우팅
// app.get('/react/*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'react-app/build/index.html'));
// });

connectDB.then(client => {  //시작!
  console.log('DB 연결 성공');
  db = client.db('pokemon');
  server.listen(8080, () => {
    console.log('http://localhost:8080 에서 실행 중');
  });
}).catch(err => {
  console.log(err);
});