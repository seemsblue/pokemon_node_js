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

let opUserId = '';

const { io } = require('../server.js');

let connectDB = require('../database.js');
const { error } = require('console');
let db;

/**
 * 1부터 1010 숫자 넣으면 해당 Id의 포켓몬 json 반환
 * @param {number} id 
 */
async function getPokemonInfoById(id){   
    //서버에서는 도감번호만 보내주고, 이 작업은 클라이언트 사이드에서 해야 할지는 고민
    //서버에서 게임을 할때마다 이미지까지 다 fetch하면 너무 오래 걸리고, 클라이언트한테 종족값까지 맡기면 위조 위험이 생기는데
    //1. 사실 해결방법은 용량이 적어서 그냥 데이터베이스에 보관하면 되는데 그럼 api 써보는 의미가 없어짐
    //2. 타협해서 포켓몬 도감번호만 서버와 유저가 공유하고, 필요한 정보는 각자 불러오는데 그러면 나중에 위조검사 확장할수는 있음
    
    // 병렬로 fetch 요청
    console.log(id);
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
    let backImg;
    if(formData.sprites.back_default != null){
        backImg = formData.sprites.back_default;
    }
    else{
        console.log(name+'은 back이미지 못찾음');
        backImg = frontImg; //back은 없는 경우도 있음
    }
    
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
    pokemon.backImg = backImg;
    pokemon.stats = data.stats; // hp atk def satk sdef spd 순
    pokemon.hp = data.stats[0].base_stat;
    pokemon.attack = data.stats[1].base_stat;
    pokemon.defense = data.stats[2].base_stat;
    pokemon.specialAttack = data.stats[3].base_stat;
    pokemon.specialDefense = data.stats[4].base_stat;
    pokemon.speed = data.stats[5].base_stat;
    let totalStat = 0;
    data.stats.map(i=> totalStat+=i.base_stat); //기타 등등 스탯 들어가있는거
    pokemon.totalStat = totalStat;  //최종 종족값

    //배틀 중 사용되는 현재 능력치
    pokemon.battleAttack = pokemon.attack;
    pokemon.battleDefense = pokemon.defense;
    pokemon.battleSpecialAttack = pokemon.specialAttack;
    pokemon.battleSpecialDefense = pokemon.specialDefense;
    pokemon.battleSpeed = pokemon.speed;
    pokemon.battleAtk = Math.max(pokemon.attack, pokemon.specialAttack);    //공격 수치 = 공격과 특공 중 높은 쪽
    pokemon.battleDef = pokemon.hp + Math.max(pokemon.defense, pokemon.specialDefense); //내구도 = 체력 + 방특방 중 높은 쪽
    pokemon.battleDefMax = pokemon.battleDef;   //최대값  
    pokemon.battleDefPercent = 100; //남은 체력의 백분율

    console.log(pokemon);
    return pokemon;
}

/**
 * 타입상성 배율 효과 계산함수
 * @param {String} atkType
 * @param {String} defType
 * @returns {Number} 배율 계산 결과 (2, 1, 0.5, 0)
 */
function typeMatch(atkType, defType) {
    let result = 1;
    switch (atkType) {
        case 'normal': {
            if (defType == 'rock' || defType == 'steel')
                result = 0.5;
            else if (defType == 'ghost')
                result = 0;
            break;
        }
        case 'fire': {
            if (defType == 'grass' || defType == 'ice' || defType == 'bug' || defType == 'steel')
                result = 2;
            else if (defType == 'fire' || defType == 'water' || defType == 'rock' || defType == 'dragon')
                result = 0.5;
            break;
        }
        case 'water': {
            if (defType == 'fire' || defType == 'ground' || defType == 'rock')
                result = 2;
            else if (defType == 'water' || defType == 'grass' || defType == 'dragon')
                result = 0.5;
            break;
        }
        case 'electric': {
            if (defType == 'water' || defType == 'flying')
                result = 2;
            else if (defType == 'electric' || defType == 'grass' || defType == 'dragon')
                result = 0.5;
            else if (defType == 'ground')
                result = 0;
            break;
        }
        case 'grass': {
            if (defType == 'water' || defType == 'ground' || defType == 'rock')
                result = 2;
            else if (defType == 'fire' || defType == 'grass' || defType == 'poison' || defType == 'flying' || defType == 'bug' || defType == 'dragon' || defType == 'steel')
                result = 0.5;
            break;
        }
        case 'ice': {
            if (defType == 'grass' || defType == 'ground' || defType == 'flying' || defType == 'dragon')
                result = 2;
            else if (defType == 'fire' || defType == 'water' || defType == 'ice' || defType == 'steel')
                result = 0.5;
            break;
        }
        case 'fighting': {
            if (defType == 'normal' || defType == 'ice' || defType == 'rock' || defType == 'dark' || defType == 'steel')
                result = 2;
            else if (defType == 'poison' || defType == 'flying' || defType == 'psychic' || defType == 'bug' || defType == 'fairy')
                result = 0.5;
            else if (defType == 'ghost')
                result = 0;
            break;
        }
        case 'poison': {
            if (defType == 'grass' || defType == 'fairy')
                result = 2;
            else if (defType == 'poison' || defType == 'ground' || defType == 'rock' || defType == 'ghost')
                result = 0.5;
            else if (defType == 'steel')
                result = 0;
            break;
        }
        case 'ground': {
            if (defType == 'fire' || defType == 'electric' || defType == 'poison' || defType == 'rock' || defType == 'steel')
                result = 2;
            else if (defType == 'grass' || defType == 'bug')
                result = 0.5;
            else if (defType == 'flying')
                result = 0;
            break;
        }
        case 'flying': {
            if (defType == 'grass' || defType == 'fighting' || defType == 'bug')
                result = 2;
            else if (defType == 'electric' || defType == 'rock' || defType == 'steel')
                result = 0.5;
            break;
        }
        case 'psychic': {
            if (defType == 'fighting' || defType == 'poison')
                result = 2;
            else if (defType == 'psychic' || defType == 'steel')
                result = 0.5;
            else if (defType == 'dark')
                result = 0;
            break;
        }
        case 'bug': {
            if (defType == 'grass' || defType == 'psychic' || defType == 'dark')
                result = 2;
            else if (defType == 'fire' || defType == 'fighting' || defType == 'poison' || defType == 'flying' || defType == 'ghost' || defType == 'steel' || defType == 'fairy')
                result = 0.5;
            break;
        }
        case 'rock': {
            if (defType == 'fire' || defType == 'ice' || defType == 'flying' || defType == 'bug')
                result = 2;
            else if (defType == 'fighting' || defType == 'ground' || defType == 'steel')
                result = 0.5;
            break;
        }
        case 'ghost': {
            if (defType == 'psychic' || defType == 'ghost')
                result = 2;
            else if (defType == 'dark')
                result = 0.5;
            else if (defType == 'normal')
                result = 0;
            break;
        }
        case 'dragon': {
            if (defType == 'dragon')
                result = 2;
            else if (defType == 'steel')
                result = 0.5;
            else if (defType == 'fairy')
                result = 0;
            break;
        }
        case 'dark': {
            if (defType == 'psychic' || defType == 'ghost')
                result = 2;
            else if (defType == 'fighting' || defType == 'dark' || defType == 'fairy')
                result = 0.5;
            break;
        }
        case 'steel': {
            if (defType == 'ice' || defType == 'rock' || defType == 'fairy')
                result = 2;
            else if (defType == 'fire' || defType == 'water' || defType == 'electric' || defType == 'steel')
                result = 0.5;
            break;
        }
        case 'fairy': {
            if (defType == 'fighting' || defType == 'dragon' || defType == 'dark')
                result = 2;
            else if (defType == 'fire' || defType == 'poison' || defType == 'steel')
                result = 0.5;
            break;
        }
        default: {
            console.log('여기 없는 타입인데? ' + atkType + '/' + defType);
        }
    }
    return result;
}


/**
 * 
 * @param {String} atkType 
 * @param {*} defPokemon 
 * 공격 타입과 피격 포켓몬을 입력하면 특성, 타입등을 고려해 데미지의 배율을 실수 숫자로 반환
 */
function typeMatchByPokemon(atkType, defPokemon) {
    let result = 1;
    //타입 계산
    defPokemon.types.forEach(element => {
        result *= typeMatch(atkType, element);
    });
    //특성 계산

    //도구 계산

    //필드 보너스 계산

    return result;
}

connectDB.then(client => {
    //console.log('배틀 라우터 DB 연결 성공');  //확인완료
    db = client.db('pokemon');
}).catch(err => {
    console.log(err);
});

router.get('/match',checkAuth,async(req,res)=>{
    let sessions = await db.collection('battle_sessions').find({status: 'waiting'}).toArray();  //매칭 안된 방만 찾아줌
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
        date_time : new Date(), //세션 유효기간 10분으로 초기화
        code:code,
        title : title,
        status : 'waiting'
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
        await db.collection('battle_sessions').updateOne(
            {_id : new ObjectId(session._id)},
            {
                $set:{
                    user2:new ObjectId(reqUserId),
                    status:'matched', //매칭됨으로 상태 변경(이 단계부터는 방 검색 안됨)
            }});
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

/**
* indices 안에 없는 인덱스의 list 요소는 삭제한 리스트 리턴(선택한 포켓몬만 남김)
*/
function filterListByIndices(list, indices) {   
    return list.filter((item, index) => indices.includes(index));
}

//  !!소켓 진행 흐름은 그림 참조
io.on('connection', async(socket) => {   //접속 할때마다 유저에게 고유한 소켓 객체가 제공
    const session = socket.request.session;
    let user = await db.collection('user').findOne({_id: new ObjectId(session.passport.user.id)});  //소켓에 접속한 현재 유저
    delete user.password;
    const myId = user._id;
    socket.roomsJoined = [];
    socket.side='';
    let side;
    let roomCode='';

    
    let homeDeck = [];  //보유중인 포켓몬
    let awayDeck = [];
    function randomPokemonId(){
        let id;

        do {
            id = Math.floor(Math.random() * 1010) + 1;
        } while (homeDeck.includes(id) || awayDeck.includes(id));   //덱에 포함되어있지 않는 수가 나올 때 까지


        //종족값 최소 보장 매커니즘은 여기보단 추출 후에 다시 추출하는 식으로 짜는게 맞을듯


        return id;
    };
    
    //wait이면 시작 대기중 play면 게임중, win이면 접속 종료 시 포인트 증가, lose면 포인트 감소
    let status = 'wait';
    let action = 'attack1'; //기본값은 1번 타입으로 공격

    let myDethCount = 0;    //먼저 2가 되면 패배
    let opDethCount = 0;

    let canSelectAction = true;

    let endFlag = false;

    //0 - 접속 이벤트
    /**
     * 
     */
    socket.on('ask-join',async(data)=>{
        console.log(data);
        socket.join(data);      //배틀 상대와 공유하는 room
        socket.join(myId);  //이 소켓과 유저간 1:1 통신 전용 room
        socket.roomsJoined.push(data);
        roomCode=data;
    })

    socket.on('away-join',async(data)=>{    //away 유저가 접속했을 때 away 유저의 정보 전송
        const session = socket.request.session;
        opUserId = session.passport.user.id;
        let awayUser = await db.collection('user').findOne({ _id: new ObjectId(opUserId)});
        delete awayUser.password;   //개인정보는 빼고 전송
        delete awayUser.email;
        io.to(data.room).emit('away-update',awayUser);
    })

    socket.on('chat',async(data)=>{
        console.log(data);
        io.to(data.room).emit('chat-cast',{msg:data.msg,side:data.side});
    })

    socket.on('select-side',async(data)=>{
        socket.side = data;
        side = data;
    })

    //1 - 게임 진행 이벤트
    /**
     * 게임 시작
     * 1. away 유저가 들어와서 select-side를 실행한다.
     * 2. away 유저의 소켓에서 game start io.to를 전송한다.
     * 3. home 유저는 start 버튼을 눌러 askStart 요청을 보낸다
     * 4. 약간의 딜레이를 가졌다가, 아무도 나가지 않았다면 start한다
     */
    let myBattlePokemon = [];  //선택한 포켓몬
    let opBattlePokemon = []  //상대가 선택한 포켓몬
    let myFieldPokemonIndex = 0; //현재 내 필드에 나와있는 포켓몬 인덱스
    let opFieldPokemonIndex = 0; //현재 상대 필드에 나와있는 포켓몬 인덱스
    let myFieldPokemon;
    let opFieldPokemon;

    let startGameTimeout;
    socket.on('askStart',async(data)=>{
        status='play';
        console.log(roomCode+'방에서 askStart');
        io.to(roomCode).emit('askStart');
        await db.collection('battle_sessions').updateOne(
        {code: roomCode},
        { $set: { date_time: new Date() } }
        );

        for(i=0;i<6;i++){   //홈 플레이어의 포켓몬 6마리의 도감번호를 선정
            homeDeck.push(randomPokemonId());
        }
        for(i=0;i<6;i++){   
            awayDeck.push(randomPokemonId());
        }

        console.log(homeDeck);
        startGameTimeout = setTimeout(() => {   //5초 뒤에 startGame 전송/ 도중에 leave요청시 중단
            io.to(roomCode).emit('startGame');
            console.log(`${roomCode}방 게임 시작!`);
            
            
            io.to(roomCode).emit('setDeck',{homeDeck:homeDeck, awayDeck:awayDeck});
            io.to(roomCode).emit('battlePhase');    

        }, 7000);
    })
    
    //내 포켓몬 선택 수신
    socket.on('select-pokemon',async(data)=>{
        status='play';
        myBattlePokemon=data;
        io.to(roomCode).emit('select-pokemon',{side:side,pokemon:myBattlePokemon});
        //console.log(myBattlePokemon);
    })
    //상대 선택 포켓몬 수신
    socket.on('opSelect',(data)=>{
        status='play';
        opBattlePokemon = data.opPokemon;
        console.log(data.opPokemon);
    })


    //턴 시작 요청 수신
    socket.on('start-turn',(data)=>{
        /**
         * 여기에 배틀 결과 계산하는 과정이 전에 있어야 함
         */

        //매 턴 계산된 필드의 결과를 전달

        //console.log('emit [start-turn]');
        //console.log(myId);

        
        myFieldPokemon = myBattlePokemon[myFieldPokemonIndex];
        opFieldPokemon = opBattlePokemon[opFieldPokemonIndex];
        
        io.to(myId).emit('start-turn',{me:myBattlePokemon[myFieldPokemonIndex],op:opBattlePokemon[opFieldPokemonIndex]});
    })

    //액션 수신 > 액션 전달
    socket.on('select-action',async(data)=>{
        if(canSelectAction){
            action = data.action;
            io.to(roomCode).emit('send-action',{side:data.side,action:action});   //어떤 사이드의 유저가 어떤 액션을 선택했는지 전송
            canSelectAction = false;
        }
    })

    //side의 필드 포켓몬 교체
    function changeFieldPokemon(side){   
        if(side == 'me'){
            myBattlePokemon[myFieldPokemonIndex] = myFieldPokemon;  //먼저 필드에 있던 포켓몬의 변화값을 덱에 저장
            myFieldPokemonIndex++;
            myFieldPokemonIndex = myFieldPokemonIndex%2;
            myFieldPokemon = myBattlePokemon[myFieldPokemonIndex];
        }
        else{
            opBattlePokemon[opFieldPokemonIndex] = opFieldPokemon;  //먼저 필드에 있던 포켓몬의 변화값을 덱에 저장
            opFieldPokemonIndex++;
            opFieldPokemonIndex = opFieldPokemonIndex%2;
            opFieldPokemon = opBattlePokemon[opFieldPokemonIndex];
        }
    }
    
    function battleAction(myAction,opAction){  //우선도와 스피드에 따라 어느쪽이 먼저 행동할지 모르기 때문에 함수로 분리해서 사용
        let log = [];
        let effect; //효과 배율 참조

        if(myBattlePokemon[myFieldPokemonIndex].speed == opBattlePokemon[opFieldPokemonIndex].speed){
            if(side=='away'){
                myBattlePokemon[myFieldPokemonIndex].battleSpeed+=0.1;
            }
            else{
                opBattlePokemon[opFieldPokemonIndex].battleSpeed+=0.1
            }
        }

        //상대 항복
        if(opAction=='surrender'){
            log.push({action:'win'});
            status = 'win';
            return log;
        }

        //교체
        if(myAction=='change'&&opAction=='change'){ //둘 다 교체라면 스피드 빠른쪽 먼저 교체
            if (myBattlePokemon[myFieldPokemonIndex].battleSpeed > opBattlePokemon[opFieldPokemonIndex].battleSpeed){   //내가 더 빠름
                changeFieldPokemon('me');
                log.push({action:'myChange'});

                changeFieldPokemon('op');
                log.push({action:'opChange'});
            }
            else{
                changeFieldPokemon('op');
                log.push({action:'opChange'});

                changeFieldPokemon('me');
                log.push({action:'myChange'});
            }
        }
        else if(myAction=='change'&&myDethCount<1){ //내 포켓몬 교체
            changeFieldPokemon('me');
            log.push({action:'myChange'});
        }
        else if(opAction=='change'&&opDethCount<1){ //상대 포켓몬 교체
            changeFieldPokemon('op');
            log.push({action:'opChange'});
        }

        if (myBattlePokemon[myFieldPokemonIndex].battleSpeed > opBattlePokemon[opFieldPokemonIndex].battleSpeed){ 
            //내가 더 빠를 때

            //내 기술 시전
            if(myAction!='change'&&myAction!='surrender'){
                effect = attackAction(myAction,'my');
                log.push({action:'myAction',detail:myAction, effect:effect});
                if(opBattlePokemon[opFieldPokemonIndex].battleDef<=0){   //상대 포켓몬 죽으면?
                    opDethCount++;
                    changeFieldPokemon('op');
                    log.push({action:'opDead'});

                    if(opDethCount==2){ //상대 포켓몬 전멸시
                        log.push({action:'win'})
                    }
                    
                    return log; //죽으면 턴 끝
                }
            }
            //이후 상대 기술 시전
            if(opAction!='change'&&opAction!='surrender'){
                effect = attackAction(opAction,'op');
                log.push({action:'opAction',detail:opAction, effect:effect});
                if(myBattlePokemon[myFieldPokemonIndex].battleDef<=0){   //내 포켓몬 죽으면?
                    myDethCount++;
                    changeFieldPokemon('me');
                    log.push({action:'myDead'});
                    if(myDethCount==2){ //내 포켓몬 전멸시
                        log.push({action:'lose'})
                    }
                    
                    return log;
                }
            }
            
        }
        else{   //상대가 더 빠를 때
            //상대 기술 시전
            if(opAction!='change'&&opAction!='surrender'){
                effect = attackAction(opAction,'op');
                log.push({action:'opAction',detail:opAction,effect:effect});
                if(myBattlePokemon[myFieldPokemonIndex].battleDef<=0){   //내 포켓몬 죽으면?
                    myDethCount++;
                    changeFieldPokemon('me');
                    log.push({action:'myDead'});
                    if(myDethCount==2){ //내 포켓몬 전멸시
                        log.push({action:'lose'});
                        status = 'lose';
                    }
                    
                    return log;
                }
            }
            //이후 내 기술 시전
            if(myAction!='change'&&myAction!='surrender'){
                effect = attackAction(myAction,'my');
                log.push({action:'myAction',detail:myAction,effect:effect});
                if(opBattlePokemon[opFieldPokemonIndex].battleDef<=0){   //상대 포켓몬 죽으면?
                    opDethCount++; 
                    changeFieldPokemon('op');
                    log.push({action:'opDead'});
                    if(opDethCount==2){ //상대 포켓몬 전멸시
                        log.push({action:'win'});
                        status = 'win';
                    }
                    
                    return log; //죽으면 턴 끝
                }
            }
        }
        
        return log;
    }

    /**
     * 공격 액션 결과 계산 > hp 등 상태변화 반영 함수
     * @returns {String} - 액션의 효과 (super,normal,weak,invalid)
     */
    function attackAction(action,owner){
        let effect = 'normal';  //기본값 normal
        let baeyul;    //몇배로 데미지가 적용되는지
        let damage;
        switch(action){
            case 'typeAttack1':{
                if(owner == 'my'){  //내 공격
                    baeyul = typeMatchByPokemon(myFieldPokemon.types[0],opFieldPokemon)
                    if(baeyul>1){           //(약점 공격)
                        effect = 'super';
                    }
                    else if(baeyul == 0){   //(무효타입 공격)
                        effect = 'invalid';
                    }
                    else if(baeyul < 1){    //(내성타입 공격)
                        effect = 'weak';
                    }

                    damage = Math.floor(myFieldPokemon.battleAtk * baeyul);
                    
                    opFieldPokemon.battleDef -= damage;   
                }
                else{               //상대 공격
                    baeyul = typeMatchByPokemon(opFieldPokemon.types[0],myFieldPokemon)
                    if(baeyul>1){           //(약점 공격)
                        effect = 'super';
                    }
                    else if(baeyul == 0){   //(무효타입 공격)
                        effect = 'invalid';
                    }
                    else if(baeyul < 1){    //(내성타입 공격)
                        effect = 'weak';
                    }

                    damage = Math.floor(opFieldPokemon.battleAtk * baeyul);

                    myFieldPokemon.battleDef -= damage;
                }
                break;
            }
            case 'typeAttack2':{
                if (myFieldPokemon.types[1]== undefined) myFieldPokemon.types[1]=myFieldPokemon.types[0];   //2번째 타입 없는데 강제요청시 예외처리
                if (opFieldPokemon.types[1]== undefined) opFieldPokemon.types[1]=opFieldPokemon.types[0];

                if(owner == 'my'){
                    baeyul = typeMatchByPokemon(myFieldPokemon.types[1],opFieldPokemon)
                    if(baeyul>1){           //(약점 공격)
                        effect = 'super';
                    }
                    else if(baeyul == 0){   //(무효타입 공격)
                        effect = 'invalid';
                    }
                    else if(baeyul < 1){    //(내성타입 공격)
                        effect = 'weak';
                    }
                    
                    damage = Math.floor(myFieldPokemon.battleAtk * baeyul);

                    opFieldPokemon.battleDef -= damage;   
                }
                else{
                    baeyul = typeMatchByPokemon(opFieldPokemon.types[1],myFieldPokemon)
                    if(baeyul>1){           //(약점 공격)
                        effect = 'super';
                    }
                    else if(baeyul == 0){   //(무효타입 공격)
                        effect = 'invalid';
                    }
                    else if(baeyul < 1){    //(내성타입 공격)
                        effect = 'weak';
                    }

                    damage = Math.floor(opFieldPokemon.battleAtk * baeyul);

                    myFieldPokemon.battleDef -= damage;   
                }
                break;
            }
            case 'normalAttack':{
                if(owner == 'my'){  
                    damage = Math.floor(myFieldPokemon.battleAtk*0.8);
                    
                    opFieldPokemon.battleDef -= damage;   
                }
                else{
                    damage = Math.floor(opFieldPokemon.battleAtk*0.8);
                    
                    myFieldPokemon.battleDef -= damage;   
                }
                break;
            }
            default : 
                console.log('잘못된 배틀 명령:'+owner+'의 '+action);
                break;
        }
        myFieldPokemon.battleDefPercent = Math.floor(100*(myFieldPokemon.battleDef / myFieldPokemon.battleDefMax));
        opFieldPokemon.battleDefPercent = Math.floor(100*(opFieldPokemon.battleDef / opFieldPokemon.battleDefMax));
        if(myFieldPokemon.battleDefPercent<=0) {myFieldPokemon.battleDefPercent=0; myFieldPokemon.battleDef=0;}   //0퍼센트 미만일 경우 0으로 수치조정 
        if(opFieldPokemon.battleDefPercent<=0) {opFieldPokemon.battleDefPercent=0; opFieldPokemon.battleDef=0;}


        myBattlePokemon[myFieldPokemonIndex] = myFieldPokemon;  //변경수치 반영
        opBattlePokemon[opFieldPokemonIndex] = opFieldPokemon;
        //console.log(`${owner}가 ${damage}데미지 입힘!`)
        return effect;
    }

    //턴 종료 수신 > 결과 계산 후 전달
    socket.on('send-action',async(data)=>{
        let opAction = data.opAction;
        let myAction = data.myAction;
        let log = battleAction(myAction,opAction);

        //액션 결과 계산
        //로그랑 포켓몬 남은 체력 등등 도 전달해줘야 할듯
        //필요없는 부분은 짤라서 전달해서 통신 데이터 양 줄이기
        console.log(`${side}/${myBattlePokemon[0].name}:${myBattlePokemon[0].battleDefPercent}%|${myBattlePokemon[1].name}:${myBattlePokemon[1].battleDefPercent}% &
            ${opBattlePokemon[0].name}:${opBattlePokemon[0].battleDefPercent}%|${opBattlePokemon[1].name}:${opBattlePokemon[1].battleDefPercent}%`)
        io.to(myId).emit('end-turn',{log:log,myPokemon:myBattlePokemon,opPokemon:opBattlePokemon});

    })

    //액션 결과 프린트 종료 수신 > 새로운 턴 시작 전달
    socket.on('end-print',async(data)=>{
        canSelectAction = true;
        io.to(roomCode).emit('end-print',{side:side});
    })


    //2 - 게임 종료 (연결끊김, 정산)
    socket.on('endGame',(data)=>{   //게임 중 상대 떠남
        status = data.result;
    })

    socket.on('leave',async(data)=>{   //게임 시작 전 상대 유저 떠남
        if(socket.side=='home'){
            try{
                await db.collection('battle_sessions').deleteOne({code:roomCode});
            }
            catch(e){
                console.log(e+'방 지우다가 에러남 아마 이미 없어진 방일수도');
            }
        }
        clearTimeout(startGameTimeout); // 예약된 startGame 있으면 취소
        //console.log(`${roomCode}방 게임 시작 취소됨...(away 연결 끊김)`);
    })

    socket.on('disconnect', async() => {
        const roomId = socket.roomsJoined[0] //방 연결 끊긴 코드는 알아냈으니 이걸로 접속 끊겼을 때 처리 하면 될듯
        console.log(socket.side+', 상태는'+status);
        socket.leave(roomId);

        let recordData = {};
        if(status == 'win' || status == 'lose'){
            try{
                recordData= {
                    opponent : opUserId,
                    myPokemon1 : myBattlePokemon[0].id,
                    myPokemon2 : myBattlePokemon[1].id,
                    opPokemon1 : opBattlePokemon[0].id,
                    opPokemon2 : opBattlePokemon[1].id,
                    result : status,
                    date_time : new Date(),
                }
            }
            catch{  //시작하기 전에 나갔거나 예기치 못한 경우 메타몽으로 표현
                recordData = {
                    opponent : opUserId,
                    opponent : opUserId,
                    myPokemon1 :132,
                    myPokemon2 : 132,
                    opPokemon1 : 132,
                    opPokemon2 : 132,
                    result : status,
                    date_time : new Date(),
                }
            }
            
        }
        
        

        //포인트 업데이트 함수
        async function updatePoint(i){
            await db.collection('user').updateOne(
             {_id: new ObjectId(session.passport.user.id)},
             {$inc:{point:i}}
            )
        }
        //최근전적 업데이트 함수
        async function updatePoint(i){
            if(opUserId == ''||status=='wait'){ //상대가 아직 접속하지 않았다면 return, 게임이 아직 시작하지 않았다면 return
                return; 
            }
            await db.collection('user').updateOne(
             {_id: new ObjectId(session.passport.user.id)},
             {$set:{recentRecord:recordData}}
            )
        }

        
        if(status=='wait'&&side=='away'){ //away가 게임 시작하기 전에 떠남
            io.to(roomId).emit('leave');    
            await db.collection('battle_sessions').updateOne(
                {code:Number(roomId)},  //문자가 아니라 숫자 형태여서 안됐었음 타입 힌트를 남기던 타입스크립트를 애요ㅇ합시다
                {
                    $set:{
                        status:'waiting', //다시 대기중으로 상태 변경(방 목록에서 노출)
                        }
                    }
            );
            console.log(roomId+'방 다시 대기방으로');
        }
        else if(status=='wait'&&side=='home'){ //home이 게임 시작하기 전에 떠남
            await db.collection('battle_sessions').deleteOne({code:Number(roomId)});    //방폭
            io.to(roomId).emit('load-match');   //강제로 매칭페이지로 이동
            return;
        }

        if(status=='play'){ //게임 중 강제종료 할 경우 상대에게 승리 플래그 지급
            updatePoint(-1);
            console.log('탈주함');
            io.to(roomId).emit('endGame',{msg:'상대가 떠났습니다',result:'win',room:roomId});
        }
        else if(status=='win'){
            updatePoint(1);
        }
        else if(status=='lose'){
            updatePoint(-1);
        }

        //자신의 전적 업데이트 insert
    })
});



module.exports = router;
