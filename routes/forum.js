const router = require('express').Router();
const {exec} = require('child_process');
const path = require('path');
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
router.get('/test',(req,res)=>{
    res.send('테스트 성공!')
})

// 리스트 페이지 구현
/**
 * @swagger
 * /list/{page}:
 *   get:
 *     summary: Retrieves a paginated list of posts
 *     tags: [forum,Page]
 *     parameters:
 *       - in: path
 *         name: page
 *         schema:
 *           type: integer
 *         required: true
 *         description: Page number
 *     responses:
 *       200:
 *         description: List of posts with pagination data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 posts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title:
 *                         type: string
 *                       category:
 *                         type: string
 *                       nickname:
 *                         type: string
 *                       time:
 *                         type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     next:
 *                       type: integer
 *                     now:
 *                       type: integer
 *                     total:
 *                       type: integer
 */
/*
0. 클라이언트는 /list?page=1 과 같은 형식으로 리스트 페이지에 접속한다.
0 ver2. /list/:page 같이 파라미터로 받는다 << 채택

1. mongo 데이터를 array로 불러와서 n개 단위로 불러오고 페이지 만큼 스킵한다.
2. 다음/이전 페이지 버튼을 활성화 할지에 대한 데이터도 전송한다(가능하면 5페이지 단위 구성도 생각해서)

+ 그냥 전체를 클라이언트에 전달하고 렌더링 시키게 하려면 db에서 제목이랑 글쓴이 정도만 추출해서 전달하면 좋을듯
+ 스크롤 내리면 계속 늘어나는 리스트 디자인은 그냥 리스트 통째로 다 넘겨주고 클라이언트에서 하나씩 렌더 하면 될 거 같음
*/
const pageCutCount = 10; // 페이지당 문서 수
router.get(['/list', '/list/:page'],async(req,res)=>{
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
          _id: 1 // 포함할 필드만 명시적 지정
      }
  })
  .sort({ _id: -1 }) // 최신 글부터 정렬  (몽고디비는 생성된 순으로 가져오므로 역순한거밈)
  .skip((page - 1) * pageCutCount)
  .limit(pageCutCount)
  .toArray();  

  //왜 아직도 content 필드까지 가져오는지는 연구 필요

  let next = (totalPages-page);
  
  let pagination ={next:next,now:Number(page),total:totalCount};  //페이지네이션에 필요할 것 같은 정보들 다 넣는곳

  console.log(page);
  
  res.render('list.ejs',{posts:result,pagination:pagination,selectedCategory: ''})
})

// 검색 페이지 구현
/**
 * @swagger
 * /search/{page}:
 *   get:
 *     summary: Search for posts based on query and category
 *     tags: [forum,Page]
 *     parameters:
 *       - in: query
 *         name: val
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Category filter
 *       - in: path
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *     responses:
 *       200:
 *         description: List of search results with pagination data
 */
  /*
  * 그냥 주소에서 val값 가져와서 db에서 제목 조회 후 찾고 list ejs 파일로 구현
  * 세부사항은 /list 와 거의 동일
  */
router.get(['/search', '/search/:page'], async (req, res) => {
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

// 글 내의 이미지 업로드 기능 정리
/**
 * @swagger
 * /upload-image:
 *   post:
 *     summary: Upload an image
 *     tags: [forum]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: Image URL
 *       400:
 *         description: Image upload failed
 */
  /*
  * aws 임시 버킷은 2일마다 버전 변경하고, 지난 버전은 2일마다 삭제하도록 규칙 설정해둠
  * 
  * 1. 에디터에서 이미지를 올리면 이 post api에서 받아서 s3에 업로드하고 이미지 주소로 바꿔서 json으로 다시 클라이언트에 전송
  * 2. 클라이언트는 그 주소 받아서 html에 렌더링하면 미리보기 가능
  * 3. 글 발행할 때는 그 주소로 img src ="~ "  태그 만들어서 그대로 저장하면 됨
  * 3.1 근데 사실 1번에서 올릴때 임시저장소에 올리는거라
  * 4. 임시저장소에 있던거 본 저장소로 옮기고 이미지 주소에 버킷부분도 수정
  */
router.post('/upload-image', uploadTMP.single('image'), (req, res) => {
  if (req.file && req.file.location) {
      res.json({ url: req.file.location }); //이미지 주소 전달
  } else {
      res.status(400).send('이미지 업로드 실패');
  }
});

// 게시물 상세 페이지 구현
/**
 * @swagger
 * /detail/{id}:
 *   get:
 *     summary: Get post details by ID
 *     tags: [forum,Page]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Post ID
 *     responses:
 *       200:
 *         description: Post details and comments
 */
router.get('/detail/:id',async(req,res)=>{
  let post = await db.collection('general forum').findOne({_id : new ObjectId(req.params.id)}); 
  let comments = await db.collection('post_comments').find({postId : new ObjectId(req.params.id)}).toArray();
  console.log(comments);
  res.render('detail.ejs',{post:post,comments:comments})
})

// 댓글 작성
/**
 * @swagger
 * /comment:
 *   post:
 *     summary: Add a comment to a post
 *     tags: [forum]
 *     requestBody:
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               comment:
 *                 type: string
 *                 description: Comment content
 *               postId:
 *                 type: string
 *                 description: Post ID
 *     responses:
 *       200:
 *         description: Comment added
 */
router.post('/comment',checkAuth,async(req,res)=>{
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

// 글쓰기 페이지 렌더링
/**
 * @swagger
 * /write:
 *   get:
 *     summary: Render the write page
 *     tags: [forum,Page]
 *     responses:
 *       200:
 *         description: Render the write page
 */
router.get('/write', checkAuth, (req, res) => {
  res.render('write.ejs');
});

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

// 글 작성 처리
/**
* @swagger
* /write:
*   post:
*     summary: Create a new post
*     tags: [forum]
*     requestBody:
*       content:
*         application/x-www-form-urlencoded:
*           schema:
*             type: object
*             properties:
*               category:
*                 type: string
*               editorContent:
*                 type: string
*               title:
*                 type: string
*     responses:
*       302:
*         description: Redirect to list or home based on the category
*       400:
*         description: Bad request, invalid category
*       404:
*         description: Error occurred during post creation
*/
router.post('/write', checkAuth, async (req, res) => {
  let category = req.body.category;
  let content = req.body.editorContent;
  let title = req.body.title;

  let categoryAuth = ['general', 'qna', 'report', 'record']; // 유저가 작성 가능한 카테고리에 글 작성 요청을 보냈는지 검사
  if (req.user.rank == 'admin') {  // 관리자는 공지사항 카테고리에 접근권한 부여
      categoryAuth.push('announcement');
  }
  
  if (!categoryAuth.includes(category)) {  // 작성 불가능한 위치로 요청 시 리다이렉트
      res.redirect('/');
      return;
  }

  let post = {
      time: await new Date(),
      user: req.user._id,
      nickname: req.user.nickname,
      title: title,
      content: content,
      category: category,
  };

  if (category == 'report') {
      try {
          await db.collection('report').insertOne(post);
          res.redirect('/home');  // 제보의 경우 홈으로 연결
      } catch {
          return res.status(404).json({ success: false, message: '게시 중 오류가 발생했습니다.' });
      }
  } else {
      await db.collection('general forum').insertOne(post);
      console.log(post);
      res.redirect('/list/1');
  }
});


router.get('/testpy', (req, res) => {
  // Python 스크립트의 절대 경로를 생성
  const pythonScriptPath = path.join(__dirname, 'scripts', 'hello.py');
  
  // Python 스크립트를 절대 경로로 실행
  exec(`"${pythonExecutable}" "${pythonScriptPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing Python script: ${error}`);
      return res.status(500).send('Internal Server Error');
    }

    if (stderr) {
      console.error(`Python script error: ${stderr}`);
      return res.status(500).send('Internal Server Error');
    }

    // Python 스크립트의 출력 결과를 클라이언트로 전송
    res.send(stdout);
  });
});

module.exports = router;
