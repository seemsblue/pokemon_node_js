/**
 * 1. 배틀 방 리스트 페이지 (매칭코드, 방 주인 닉네임) / 클릭하면 battle/매칭코드 로 라우팅
 *         비밀방은 그냥 표시만 안되게 하면 됨 검색창에 코드넣게 하고
 * 2. 한명이 들어와서 매칭이 되면 매칭 되었다는 메시지를 배틀페이지에 띄움
 * 3. 5초간 양 유저의 접속 여부를 확인한 뒤 5초 뒤에 게임 시작, 2명을 룸에 넣어줌
 * 4. 4개의 기술을 가진 랜덤 포켓몬을 2마리씩 서버에서 배정해줌
 * 5. 20초간 기술선택 시간 안에 하나의 기술을 선택해서 서버로 보냄
 * 6. 서버는 기술 결과를 계산해서 유저에게 보내고, 게임이 끝나면 승패 포인트 변화를 서버에 저장함
 * 
 * 배틀 세션 유통기한은 10분
 */

const router = require('express').Router();
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { checkAuth } = require('../server.js'); // 미들웨어 파일 경로에 맞게 수정


const { io } = require('../server.js');

let connectDB = require('../database.js');
const { error } = require('console');
let db;

/**
 * 1부터 1010 숫자 넣으면 해당 Id의 포켓몬 json 반환
 * @param {number} id 
 */
async function selectPokemonById(id){   
    //서버에서는 도감번호만 보내주고, 이 작업은 클라이언트 사이드에서 해야 할지는 고민
    //서버에서 게임을 할때마다 이미지까지 다 fetch하면 너무 오래 걸리고, 클라이언트한테 종족값까지 맡기면 위조 위험이 생기는데
    //1. 사실 해결방법은 용량이 적어서 그냥 데이터베이스에 보관하면 되는데 그럼 api 써보는 의미가 없어짐
    //2. 타협해서 포켓몬 도감번호만 서버와 유저가 공유하고, 필요한 정보는 각자 불러오는데 그러면 나중에 위조검사 확장할수는 있음
    
    // 병렬로 fetch 요청
    let [response, speciesResponse, formResponse] = await Promise.all([
        fetch(`https://pokeapi.co/api/v2/pokemon/${id}`),
        fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`),
        fetch(`https://pokeapi.co/api/v2/pokemon-form/${id}`)
    ]);
    // 각 응답을 JSON으로 변환
    let data = await response.json();
    let speciesData = await speciesResponse.json();
    let formData = await formResponse.json();

    let frontImg = formData.sprites.front_default;
    
    let jpSpecies = speciesData.names.find(i => i.language.name === "ja-Hrkt");
    let name = jpSpecies.name;
    try{
        let krSpecies = speciesData.names.find(i => i.language.name === "ko");
        name = krSpecies.name;
    }catch(e){
        console.log('포켓몬 한글이름 없는듯 '+e);
    }


    let pokemon ={};
    pokemon.name = name;    //이름(한글 우선, 없으면 일본어)
    pokemon.id = id;    //도감코드
    pokemon.types = data.types.map(typeInfo => typeInfo.type.name); //타입
    pokemon.frontImg = frontImg;
    pokemon.stats = data.stats;
    let totalStat = 0;
    data.stats.map(i=> totalStat+=i.base_stat); //기타 등등 스탯 들어가있는거
    pokemon.totalStat = totalStat;  //최종 종족값
    console.log(pokemon);
    return pokemon;
}

connectDB.then(client => {
    //console.log('배틀 라우터 DB 연결 성공');  //확인완료
    db = client.db('pokemon');
}).catch(err => {
    console.log(err);
});

router.get('/match',checkAuth,async(req,res)=>{
    let sessions = await db.collection('battle_sessions').find().toArray();
    res.render('battle/match.ejs',{sessions:sessions});
})
router.get('/rooms-json',async(req,res)=>{  //room 리스트를 json으로 반환
    try{
        let sessions = await db.collection('battle_sessions').find().toArray();
        console.log(sessions);
        res.json(sessions);
    }
    catch(e){
        console.error('fetching 에러',e);
        res.status(500).json({error:'서버에러'});
    }
})

//매칭 페이지에서 create-room 요청을 보내면 db에 배틀 세션 데이터 발행
router.post('/create-room',checkAuth,async(req,res)=>{
    let code;
    let title = req.body.title;
    
    if(title==''){
        res.redirect('/match');
        return;
    }
    //4자리 랜덤 숫자를 생성하고, 현재 db에 겹치는 숫자 있는지 검색 > 유니크 할때까지 반복
    let existingCode=false;
    do {
        code = Math.floor(1000 + Math.random() * 9000); // 1000에서 9999 사이의 4자리 숫자
        existingCode = await db.collection('battle_sessions').findOne({ code: code });
    } while (existingCode);

    await db.collection('battle_sessions').insertOne({
        user1:req.user._id,
        user2:null,
        nick:req.user.nickname,
        //데이터 수명을 정할 때 mongo에서 2가지 방법을 쓸 수 있는데 일단 여기서는 date_time으로부터 10분이 지나면 삭제되게 index 짜둠
        date_time : new Date(),
        code:code,
        title : title,
    });
    res.redirect('/battle/'+code);
})

router.get('/battle/:code',checkAuth,async(req,res)=>{
    let code=Number(req.params.code);
    let session = await db.collection('battle_sessions').findOne({code:code});
    if(!session){   //세션이 존재하지 않으면 매칭 페이지로 리다이렉트
        res.redirect('/match');
        return;
    }

    //주어진 id 자료형 확인하고 문자열 형태로 바꾸기(이렇게까지 할 필요는 없는데 연습삼아)
    const sessionUser1Id = session.user1 instanceof ObjectId ? session.user1.toString() : session.user1;
    const reqUserId = req.user._id instanceof ObjectId ? req.user._id.toString() : req.user._id;
    let side;
    if (sessionUser1Id === reqUserId) { //방 주인이라면 home으로 참가
        side = 'home'
    } else if(session.user2==null||session.user2==req.user._id.toString()){ //두번째 유저 자리가 비어있다면 away로 참가
        
        side = 'away'
        await db.collection('battle_sessions').updateOne({_id : new ObjectId(session._id)},{$set:{user2:new ObjectId(reqUserId)}});
    }
    else{   //관전자라면...?
        side = 'spectator'
    }

    let currentUser = await db.collection('user').findOne({ _id: new ObjectId(sessionUser1Id) });
    delete currentUser.password;
    delete currentUser.email;
    //console.log(currentUser);

    res.render('battle/battle.ejs',{session:session,side:side,home:currentUser});
});

io.on('connection', async(socket) => {   //접속 할때마다 유저에게 고유한 소켓 객체가 제공
    //console.log(socket);
    socket.roomsJoined = [];
    socket.side='';
    let code='';
    const randomPokemonId = () => Math.floor(Math.random() * 1010) + 1;
    let gameDeck = [];  //보유중인 포켓몬

    selectPokemonById(randomPokemonId)
    //console.log(await selectPokemonById(randomNumber));


    const session = socket.request.session;
    
    let user = await db.collection('user').findOne({_id: new ObjectId(session.passport.user.id)});  //소켓에 접속한 현재 유저
    delete user.password;
    //console.log(user);
    
    let status = 'wait' //wait이면 시작 대기중 play면 게임중, win이면 접속 종료 시 포인트 증가, lose면 포인트 감소

    socket.on('ask-join',async(data)=>{
        console.log(data);
        socket.join(data);
        socket.roomsJoined.push(data);
        code=data;
    })

    socket.on('away-join',async(data)=>{    //away 유저가 접속했을 때 away 유저의 정보 전송
        const session = socket.request.session;
        const userId = session.passport.user.id;
        let awayUser = await db.collection('user').findOne({ _id: new ObjectId(userId)});
        delete awayUser.password;
        delete awayUser.email;
        io.to(data.room).emit('away-update',awayUser);
    })

    socket.on('chat',async(data)=>{
        console.log(data);
        io.to(data.room).emit('chat-cast',{msg:data.msg,side:data.side});
    })

    socket.on('select-side',async(side)=>{
        socket.side = side;
    })

    /**
     * 게임 시작 논리
     * 1. away 유저가 들어와서 select-side를 실행한다.
     * 2. away 유저의 소켓에서 game start io.to를 전송한다.
     * 3. home 유저는 start 버튼을 눌러 askStart 요청을 보낸다
     * 4. 약간의 딜레이를 가졌다가, 아무도 나가지 않았다면 start한다
     */
    let startGameTimeout; 
    socket.on('askStart',async(data)=>{
        console.log(code+'방에서 askStart');
        io.to(code).emit('askStart');

        startGameTimeout = setTimeout(() => {   //5초 뒤에 startGame 전송/ 도중에 leave요청시 중단
            
            io.to(code).emit('startGame');
            console.log(`${code}방 게임 시작!`);
            for(i=0;i<6;i++){
                gameDeck.push(randomPokemonId);
            }
            io.to(code).emit('setDeck',{gameDeck:gameDeck});
        }, 7000);
    })


    /**
     * endGame을 수신받는 경우
     * 0. 승부가 나서 각자 endGame 전송
     * 1. 상대가 떠나서 유저가 서버로부터 승리 통보를 받고, 그걸 다시 서버에 알림
     * 2. 항복을 눌러서 먼저 패배정보 전송
     */
    socket.on('endGame',async(data)=>{
        console.log('endGame 수신됨')
        status = data.result;   //결과 반영
    })

    socket.on('leave',async(data)=>{   //게임 시작 전 상대 유저 떠남
        if(socket.side=='home'){
            try{
                await db.collection('battle_sessions').deleteOne({code:code});
            }
            catch(e){
                console.log(e+'방 지우다가 에러남 아마 이미 없어진 방일수도');
            }
        }
        clearTimeout(startGameTimeout); // 예약된 startGame 있으면 취소
        console.log(`${code}방 게임 시작 취소됨...(away 연결 끊김)`);
    })

    socket.on('disconnect', async() => {
        const roomId = socket.roomsJoined[0] //방 연결 끊긴 코드는 알아냈으니 이걸로 접속 끊겼을 때 처리 하면 될듯
        console.log(socket.side);
        socket.leave(roomId);

        //포인트 업데이트 함수
        async function updatePoint(i){
            await db.collection('user').updateOne(
             {_id: new ObjectId(session.passport.user.id)},
             {$inc:{point:i}}
        )
        }
        
        if(status=='wait'){
            io.to(roomId).emit('leave');    //게임 시작하기 전에 떠남
        }
        if(status=='play'){ //게임 중 강제종료 할 경우 상대에게 승리 플래그 지급
            updatePoint(-1);
            console.log('탈주함');
            io.to(roomId).emit('endGame',{msg:'상대가 떠났습니다',result:'win',room:roomId});
        }
        else if(status=='win'){
            updatePoint(1);
            console.log('이김');
        }
        else if(status=='lose'){
            updatePoint(-1);
            console.log('짐');
        }
    })
});



module.exports = router;
