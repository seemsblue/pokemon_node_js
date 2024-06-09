const router = require('express').Router();
const {exec} = require('child_process');
const path = require('path');


router.get('/test',(req,res)=>{
    res.send('테스트 성공!')
})

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
