const express = require('express');
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
const app = express();

//실시간 통신 소켓 관련
const { createServer } = require('http');
const { Server } = require('socket.io');
const server = createServer(app);
const io = new Server(server);
  //이 모듈을 사용하는 라우트 불러오기 위에 먼저 적어야 함 (상호참조는 되는데 이런거 주의)

//const url = process.env.DB_URL;
let connectDB = require('./database.js')
let db;

connectDB.then(client => {
  console.log('DB 연결 성공');
  db = client.db('pokemon');
  server.listen(8080, () => {
    console.log('http://localhost:8080 에서 실행 중');
  });
}).catch(err => {
  console.log(err);
});

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

//aws 임시 버킷은 2일마다 버전 변경하고, 지난 버전은 2일마다 삭제하도록 규칙 설정해둠
const uploadTMP = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'tmpraccon',
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



io.engine.use(sessionMiddleware);




// 세팅 끝

//미들웨어 => 사실 미들웨어도 middlewares.js 파일로 분리하는 편이 관리가 편하다고 함 시간나면 그렇게 하기
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
module.exports = { checkAuth, checkGuest, io };   //파일당 한번만

//라우트
app.use('/', require('./routes/forum.js'))
app.use('/', require('./routes/battle.js'))


app.use('/list', (req, res, next) => {
  console.log(new Date());
  next();
});


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
      password:password,
      rank:'normal',
      icon:'/image/램프라.jpg',
      point:10,
  })

  res.redirect('/login');
  
})

app.get('/mypage',checkAuth,(req, res) =>{
  res.render('mypage.ejs',{user:req.user})
});

app.get('/write',checkAuth,(req,res)=>{
  res.render('write.ejs');
})

// 이미지 이동 함수
const moveImageToPermanentBucket = async (tmpImageUrl) => {
  const tmpBucket = 'tmpraccoon';
  const permBucket = 'raccoonspring1';

  const imageName = tmpImageUrl.split('/').pop();

  try {
      // 임시 버킷에서 실제 버킷으로 복사
      await s3.copyObject({
          Bucket: permBucket,
          CopySource: `${tmpBucket}/${imageName}`,
          Key: imageName
      }).promise();

      // 임시 버킷에서 이미지 삭제
      await s3.deleteObject({
          Bucket: tmpBucket,
          Key: imageName
      }).promise();

      return `https://${permBucket}.s3.amazonaws.com/${imageName}`;
  } catch (err) {
      console.error('Error moving image:', err);
      throw err;
  }
};

app.post('/write',checkAuth,async(req,res)=>{
  let category = req.body.category;
  let content = req.body.editorContent;
  let title = req.body.title;

  let categoryDefine = ['general','q']; //유저가 작성 가능한 카테고리에 글 작성 요청을 보냈는지 검사
  if(req.user.rank=='admin'){ //관리자일 경우 공지사항 카테고리에 접근권한 부여
    categoryDefine.push('announcement')
  }
  if(!categoryDefine.includes(category)){ //작성 불가능한 위치로 요청보냄(post 자체를 위조했으므로 악성 유저일 확률 높음 나중에 처리)
    req.redirect('/');
    return;
  }

  let post = {
    time: await new Date(),
    user:req.user._id,
    nickname:req.user.nickname,
    title:title,
    content:content,
    category:category,
  }
  await db.collection('general forum').insertOne(post);
  console.log(post);
  res.redirect('/list/1');
})

//리스트 페이지 구현
/*
  0.클라이언트는 /list?page=1 과 같은 형식으로 리스트 페이지에 접속한다.
  0 ver2. /list/:page 같이 파라미터로 받는다 << 채택

  1.mongo 데이터를 array로 불러와서 n개 단위로 불러오고 페이지 만큼 스킵한다.
  2.다음/이전 페이지 버튼을 활성화 할지에 대한 데이터도 전송한다(가능하면 5페이지 단위 구성도 생각해서)
  
  + 그냥 전체를 클라이언트에 전달하고 렌더링 시키게 하려면 db에서 제목이랑 글쓴이 정도만 추출해서 전달하면 좋을듯
  + 스크롤 내리면 계속 늘어나는 리스트 디자인은 그냥 리스트 통째로 다 넘겨주고 클라이언트에서 하나씩 렌더 하면 될 거 같음
*/
app.get(['/list', '/list/:page'],async(req,res)=>{
  const page = req.params.page || '1';
  const cut = 2;  //몇개씩 보여줄 것인지?
  if(Number(page)<1){
    res.redirect('/list/1')
    console.log('잘못된 페이지')
    return;
  }

  // 전체 문서 개수 계산
  const totalCount = await db.collection('general forum').countDocuments();
  const totalPages = Math.ceil(totalCount / cut);

  let result = await db.collection('general forum').find({},{title:1,category:1,nickname:1,content: 0}).skip((page-1)*cut).limit(cut).toArray(); //전체 찾고, 페이지만큼 스킵하고, 개수 끊어서 할당
  console.log(result);  //왜 아직도 content 필드까지 가져오는지는 연구 필요
  
  let next = (totalPages-page);
  
  let pagination ={next:next,now:Number(page),total:totalCount};  //페이지네이션에 필요할 것 같은 정보들 다 넣는곳

  console.log(page);
  
  res.render('list.ejs',{posts:result,pagination:pagination})
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

//기능 정리
//아이콘 구현한거랑 비슷한데, 
/**
 * aws 임시 버킷은 2일마다 버전 변경하고, 지난 버전은 2일마다 삭제하도록 규칙 설정해둠
 * 
 * 1. 에디터에서 이미지를 올리면 이 post api에서 받아서 s3에 업로드하고 이미지 주소로 바꿔서 json으로 다시 클라이언트에 전송
 * 2. 클라이언트는 그 주소 받아서 html에 렌더링하면 미리보기 가능
 * 3. 글 발행할 때는 그 주소로 img src ="~ "  태그 만들어서 그대로 저장하면 됨
 * 3.1 근데 사실 1번에서 올릴때 임시저장소에 올리는거라
 * 4. 임시저장소에 있던거 본 저장소로 옮기고 이미지 주소에 버킷부분도 수정
 * 
 */
app.post('/upload-image', uploadTMP.single('image'), (req, res) => {
  if (req.file && req.file.location) {
      res.json({ url: req.file.location });
  } else {
      res.status(400).send('이미지 업로드 실패');
  }
});

app.get('/detail/:id',async(req,res)=>{
  let result = await db.collection('general forum').findOne({_id : new ObjectId(req.params.id)}); 
  console.log(result);
  let comments = [];
  res.render('detail.ejs',{post:result,comment:comments})
})


