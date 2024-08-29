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
const { time } = require('console');
let db;



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
//미들웨어 끝

//라우팅
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
})

//추후 github와 연동해서 업데이트 내용 알아서 가져오게
app.get('/update',async(req,res)=>{
  res.render('update.ejs');
})

app.use('/', require('./routes/forum.js')) //  '/'경로에 대해 아래 파일들에서 정의된 경로도 사용한다는 뜻
app.use('/', require('./routes/battle.js'))


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
    msg='닉네임이 중복이거나 잘못된 전송이네요'
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

  if(nickname.length<2){
    res.redirect('/register?msg=nickname');
    return;
  }
  else if(password.length<3){
    res.redirect('/register?msg=password');
    return;
  }

  if(await db.collection('user').findOne({email:email}) != null){
    res.redirect('/register?msg=email');
    return;
  }
  else if(await db.collection('user').findOne({nickname:nickname}) != null){  //닉네임이 중복이라면
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
      time: new Date(),
  })

  res.redirect('/login');
  
})

app.get('/mypage',checkAuth,async (req, res) =>{
  console.log(req.user);
  const userId=req.user._id;
  const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });  //새로 불러와야 세션보다 최신 상태 유지함 필요함
  user.purchase = user.purchase || [];  //구매 항목이 없으면 빈배열으로라도 전달 << 이 방법 다 적용해야 할듯 이게 짱이다 어떤 상황에서도 
  res.render('mypage.ejs',{user:user})
});

//아이콘 구매 요청
app.post('/purchase-icon', async (req, res) => {
  const { iconName, iconCost } = req.body;
  const userId = req.user._id;

  try {
      // 유저 정보 가져오기
      const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });

      if (!user) {
          return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
      }

      // 유저의 구매 리스트 가져오기
      const updatedPurchase = user.purchase || [];

      // 이미 구매한 아이콘인지 확인
      if (updatedPurchase.includes(iconName)) {
          return res.status(400).json({ success: false, message: '이미 구매한 아이콘입니다.' });
      }

      // 포인트가 충분한지 확인
      if (user.point < iconCost) {
          return res.status(400).json({ success: false, message: '포인트가 부족합니다.' });
      }

      // 포인트 차감 및 아이콘 추가
      updatedPurchase.push(iconName);
      let cPoint  =user.point - iconCost;
      await db.collection('user').updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              point: cPoint, // 포인트 업데이트
              purchase: updatedPurchase // 구매 리스트 업데이트
          }
          }
      );
      res.json({ success: true });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, message: '구매 처리 중 오류 발생!!!!!!!!!' });
  }
});

app.post('/update-icon', checkAuth, async (req, res) => {
  const userId = req.user._id; // 로그인된 사용자 ID (세션에서 가져옴)
  const { icon } = req.body;

  try {
    // 유저가 실제로 소유한 아이콘인지 확인
    const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });

    if (!user) {
      return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
    }

    if (!user.purchase.includes(icon)) {
      return res.status(400).json({ success: false, message: '아이콘을 구매하세여' });
    }

    // 유저의 현재 아이콘 업데이트
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

//닉네임 변경
app.post('/update-nickname',async(req,res)=>{
  const userId = req.user._id;
  const nickname = req.body.nickname;
  if(req.body.nickname.length>8 || req.body.nickname.length<2){ //닉네임이 너무 길거나 짧다면
    return res.status(400).json({ success: false, message: '닉네임 길이가 이상한데요' });
  } else if(await db.collection('user').findOne({nickname:nickname}) != null){
    return res.status(400).json({ success: false, message: '닉네임이 중복이네요' });
  }

  try {
    await db.collection('user').updateOne(
        { _id: new ObjectId(userId) },
        { $set: { nickname: req.body.nickname } }
    );
    res.json({ success: true });
} catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: '닉네임 변경 중 오류 발생' });
}
})

//프로필 사진 프사 변경
app.post('/upload-icon', uploadTMP.single('image'), async (req, res) => {
  const userId = req.user._id;

  if (!req.file || !req.file.location) {
      return res.status(400).send('이미지 업로드 실패');
  }

  const iconUrl = req.file.location;

  try {
      // Update the user's icon field with the uploaded image URL
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


//탈퇴 요청
app.post('/byebyebye',async(req,res)=>{
  const userId = req.user._id;
  const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });
  if(user.password == await bcrypt.hash(req.body.password,10)){ //비밀번호가 일치하면 탈퇴
    await db.collection('user').deleteOne({ _id: new ObjectId(userId) }); //최종 삭제
    res.json({ success: true });
  }
  else{
    return res.status(400).json({ success: false, message: '비밀번호가 일치하지 않아요...' });
  }
})



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

  let categoryAuth = ['general','qna','report','record']; //유저가 작성 가능한 카테고리에 글 작성 요청을 보냈는지 검사
  if(req.user.rank=='admin'){ //관리자일 경우 공지사항 카테고리에 접근권한 부여
    categoryAuth.push('announcement')
  }
  if(!categoryAuth.includes(category)){ //작성 불가능한 위치로 요청보냄(post 자체를 위조했으므로 악성 유저일 확률 높음 나중에 처리)
    res.redirect('/');
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

  if(category == 'report'){
    try{
      await db.collection('report').insertOne(post);
      res.redirect('/home');  //제보의 경우 홈으로 연결
    }
    catch{
      return res.status(404).json({ success: false, message: '게시 중 오류가 발생했습니다.' });
    }
    
  }
  else{
    await db.collection('general forum').insertOne(post);
    console.log(post);
    res.redirect('/list/1');
  }
})

//건의사항 작성 페이지는 따로 관리 (post 요청은 write 게시판과 권한 분리할 필요가 없으므로 write post요청에서 한번에 처리)
app.get('/report',checkAuth,(req,res)=>{
  res.render('writeReport.ejs');
})

//개발자(관리자) 전용 제보 확인 페이지
app.get('/admin-report',checkAdmin,async(req,res)=>{
  let reports = []; //자꾸 여기다 const 쓸래?????????????? 진짜 아오
  try {
    // report 컬렉션에서 모든 문서 가져오기
    reports = await db.collection('report').find().toArray();
    
    // 가져온 데이터를 adminReport.ejs 파일로 전달하여 렌더링
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).send('몽고디비 서버 오류');
  }

  res.render('adminReport', { reports });
})

app.post('/delete-report',checkAdmin,async(req,res)=>{
  const reportId = req.body.id;
  try{
    await db.collection('report').deleteOne({ _id: new ObjectId(reportId) }); //최종 삭제
    res.json({ success: true });
  }
  catch{
    res.status(500).send('몽고디비 서버 오류');
  }
  
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
const pageCutCount = 10; // 페이지당 문서 수


app.get(['/list', '/list/:page'],async(req,res)=>{
  const page = req.params.page || '1';
  if(Number(page)<1){
    res.redirect('/list/1')
    console.log('잘못된 페이지')
    return;
  }

  // 전체 문서 개수 계산
  const totalCount = await db.collection('general forum').countDocuments();
  const totalPages = Math.ceil(totalCount / pageCutCount);

  let result = await db.collection('general forum')
  .find({}, {
      projection: {
          title: 1,
          category: 1,
          nickname: 1,
          time:1,
          _id: 1 // 포함할 필드만 명시적으로 지정합니다
      }
  })
  .sort({ _id: -1 }) // 최신 글부터 정렬  (몽고디비는 생성된 순으로 가져오므로 역순한거밈)
  .skip((page - 1) * pageCutCount)
  .limit(pageCutCount)
  .toArray();  //console.log(result);  
  //왜 아직도 content 필드까지 가져오는지는 연구 필요
  
  let next = (totalPages-page);
  
  let pagination ={next:next,now:Number(page),total:totalCount};  //페이지네이션에 필요할 것 같은 정보들 다 넣는곳

  console.log(page);
  
  res.render('list.ejs',{posts:result,pagination:pagination,selectedCategory: ''})
})

//검색 페이지 구현
/*
* 그냥 주소에서 val값 가져와서 db에서 제목 조회 후 찾고 list ejs 파일로 구현
* 세부사항은 /list 와 거의 동일
*/
app.get(['/search', '/search/:page'], async (req, res) => {
  const searchQuery = req.query.val || '';  // 제목 검색 키워드
  const category = req.query.category || '';  // 카테고리 키워드
  const page = req.query.page || '1';

  if (Number(page) < 1) {
      res.redirect(`/search?val=${encodeURIComponent(searchQuery)}&category=${encodeURIComponent(category)}&page=1`);
      console.log('잘못된 페이지');
      return;
  }

  // 검색 조건 설정
  let searchCondition = {};
  
  if (searchQuery) {
      searchCondition.title = { $regex: searchQuery, $options: 'i' };  // 제목 검색 조건
  }

  if (category) {
      searchCondition.category = category;  // 카테고리 검색 조건
  }

  // 문서 개수 계산
  const totalCount = await db.collection('general forum').countDocuments(searchCondition);
  const totalPages = Math.ceil(totalCount / pageCutCount);

  let result = await db.collection('general forum').find(searchCondition, { title: 1, category: 1, nickname: 1, time:1})
      .sort({ _id: -1 }) // 최신 글부터 정렬  (몽고디비는 생성된 순으로 가져오므로 역순한거밈)
      .skip((page - 1) * pageCutCount)
      .limit(pageCutCount)
      .toArray();

  let next = (totalPages - page);

  let pagination = { next: next, now: Number(page), total: totalCount };

  res.render('list.ejs', { posts: result, pagination: pagination, searchQuery: searchQuery, selectedCategory: category });
});


//글 내의 이미지 업로드 기능 정리
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
      res.json({ url: req.file.location }); //이미지 주소 전달
  } else {
      res.status(400).send('이미지 업로드 실패');
  }
});
//게시물 업로드 끝

app.get('/detail/:id',async(req,res)=>{
  let post = await db.collection('general forum').findOne({_id : new ObjectId(req.params.id)}); 
  let comments = await db.collection('post_comments').find({postId : new ObjectId(req.params.id)}).toArray();
  console.log(comments);
  res.render('detail.ejs',{post:post,comments:comments})
})

app.post('/comment',checkAuth,async(req,res)=>{
  let content = req.body.comment; //ejs 파일의 name 속성과 일치해야 함
  let postId = new ObjectId(req.body.postId); //부모 글의 아이디

  let comment = {
    postId : postId,
    time: await new Date(),
    user:req.user._id,
    nickname:req.user.nickname,
    content:content,
  }
  await db.collection('post_comments').insertOne(comment);
  //console.log(comment);
  res.redirect(`/detail/${postId}`);  //글 위치로 새로고침
})

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