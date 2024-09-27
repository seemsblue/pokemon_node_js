//Mongo DB
const { MongoClient } = require('mongodb');
const url = process.env.DB_URL;
let connectDB = new MongoClient(url).connect();


//모듈화해서 export
module.exports = connectDB  //db 연결 여부까지 확인해서 전달하는건 오래걸리는 작업이라 그건 각자 해야함
/**
 * 이렇게 해두면
 * connectDB.then(client => {
  db = client.db('pokemon');
  httpServer.listen(8080, () => {
    //성공시 코드
  });
}).catch(err => {
  console.log(err);
}); 
처럼 then부터 쓰면 됨
커넥트를 한번만 하기 때문에 db 부담을 줄인거임
 */