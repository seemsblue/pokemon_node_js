const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const methodOverride = require('method-override');
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo');
require('dotenv').config();
const { S3Client, DeleteObjectCommand  } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { createServer } = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const app = express();

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
app.use(express.static(__dirname + '/public'));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: '1234', //암호화 비번인데 지금은 안쓸거임
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 1000 * 60 * 24 * 30 },
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

const httpServer = createServer(app);
const io = new Server(httpServer);

io.engine.use(sessionMiddleware);

const url = process.env.DB_URL;
let db;

new MongoClient(url).connect().then(client => {
  console.log('DB 연결 성공');
  db = client.db('pokemon');
  httpServer.listen(8080, () => {
    console.log('http://localhost:8080 에서 실행 중');
  });
}).catch(err => {
  console.log(err);
});


// 세팅 끝

//미들웨어 적어놓는 곳

io.on('connection', (socket) => {
  socket.on('ask-join', (data) => {
    console.log(socket.request.session);
    // socket.join(data);
  });
});

app.use('/list', (req, res, next) => {
  console.log(new Date());
  next();
});

function checkAuth(req,res,next){ //로그인이 필요한 곳에 가져다 쓰는 미들웨어 / 로그아웃 상태일 시 /login으로 redirect
  if(req.isAuthenticated()) {
    return next();
  }

  res.redirect('/login');
}

function checkGuest(req,res,next){ //로그인 상태일 시 '/'으로 redirect
  if(req.isAuthenticated()) {
    return res.redirect('/');
  }

  next();
}

//미들웨어 끝

app.get('/',(request,response)=>{
  console.log(request.user)
  response.render('home.ejs')
})

app.get('/login',checkGuest,(req,res)=>{
  if (req.isAuthenticated()) {
    res.redirect('/')
  }

  res.render('login.ejs')
})

app.post('/login',async(요청,응답,next)=>{
  //post할때 위에 있는 코드 실행
  passport.authenticate('local', (error,user,info)=>{
      if(error) return 응답.status(500).json(error)
      if(!user) return 응답.status(401).json(info.message)
      요청.logIn(user,(err)=>{
          if(err) return next(err)
          응답.redirect('/')
      })
  })(요청,응답,next)
})

app.get('/logout', function(req, res, next) {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

app.get('/register',checkGuest,(req,res)=>{
  let msg = '당장 이 문서에 서명하시오';
  if(req.query.msg=='nickname'){
    msg='닉네임이 중복이네요'
  }
  else if(req.query.msg=='password'){
    msg='비번으로 그런거 하지 마세요'
  }
  else if(req.query.msg=='email'){
    msg='이메일이 중복이네요'
  }
  res.render('register.ejs',{msg:msg})
})

app.post('/register',async (req,res)=>{
  
  let email = req.body.email
  let nickname = req.body.nickname
  let password = await bcrypt.hash(req.body.password,10)

  if(await db.collection('user').findOne({email:email}) != null){
    res.redirect('/register?msg=email');
    return;
  }
  else if(await db.collection('user').findOne({nickname:nickname}) != null){
    res.redirect('/register?msg=nickname');
    return;
  }

  await db.collection('user').insertOne({
      email:email,
      nickname:nickname,
      password:password
  })

  res.redirect('/login');
  
})

app.get('/mypage',checkAuth,(req, res) =>{
  res.render('mypage.ejs',{user:req.user})
});

app.get('/write',checkAuth,(req,res)=>{
  res.render('write.ejs');
})

app.post('/write',checkAuth,async(req,res)=>{
  let content = req.body.editorContent;
  let title = req.body.title;
  let post = {
    time: await new Date(),
    user:req.user._id,
    nickname:req.user.nickname,
    title:title,
    content:content,
  }
  await db.collection('general forum').insertOne(post);
  console.log(post);
})

app.get('/list',(req,res)=>{

})


//진척이 너무 안나가서 기능 먼저 정리계획 하고 구현
/* 
  0. 마이페이지 등 사용자 정보가 표시되는 곳에서 프로필 이미지가 표시된다

  1.마이페이지에서 이미지 업로드하고 post 요청을 보낸다
  2.서버에서 받아서 이미지랑 유저 id 검사
  3.s3에 업로드 하고 user 정보에 icon 링크 업데이트
  4.원래 링크에 해당하는 예전 이미지 s3에서 지울 수 있으면 지워보기
*/
app.post('/upload-icon',checkAuth,async(req,res)=>{
  const userId = new ObjectId(req.user._id);
  const user = await db.collection('user').findOne({ _id: userId });
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.log(err);
      return res.status(500).send('이미지 업로드 실패: ' + err.message);
    }
    

    try {
      //console.log('이미지 링크 : '+req.file.location);
      

      //유저의 이미지 링크 업데이트
      await db.collection('user').updateOne({ _id: userId }, { $set: { icon: req.file.location } });

      res.redirect('/mypage');
    } catch (e) {
      console.log(e);
      res.status(500).send('서버 에러: ' + e.message);
    }
  });

  // S3에서 원래 이미지 지우기
  try{
  if (user && user.icon) {
    const deleteParams = {
      Bucket: 'raccoonspring1',
      Key: user.icon.split('.com/')[1]  //key 값은 그러니까 링크에서 번호만 있는 부분임
    };
    await s3.send(new DeleteObjectCommand(deleteParams));
  }}
  catch(e){
    console.log('지우다가 에러난듯'+e);
  }
})