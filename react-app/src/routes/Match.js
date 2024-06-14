import React, { useState, useEffect } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import styles from '../css/main.module.css';
import Nav from '../modules/nav';

function Match() {
    const [rooms, setRooms] = useState([]);  // 방 목록
    const [makeRoomVisible, setMakeRoomVisible] = useState(false);
    const [findRoomVisible, setFindRoomVisible] = useState(false);
    const [roomCode, setRoomCode] = useState('');

    const toggleMakeRoom = () => {
        setMakeRoomVisible(!makeRoomVisible);
    };
    const toggleFindRoom = () => {
        setFindRoomVisible(!findRoomVisible);
    };

    const getRooms = async () => {  // 서버에 방 목록 JSON 요청 함수
        try {
            const json = await (await fetch(`/rooms-json`)).json();
            setRooms(json);
        } catch (e) {
            console.error('룸 정보 받아오기 실패', e);
        }
    };

    const handleRoomCodeChange = (event) => {   //방 코드 input 받아오기
        setRoomCode(event.target.value);
    };

    useEffect(() => {
        getRooms();
        // 10초마다 getRooms() 호출
        const interval = setInterval(() => {
            getRooms();
        }, 10000);

        // 컴포넌트가 언마운트되면 interval 정리
        return () => clearInterval(interval);
    }, []);

    return (
        <div>
            <Nav />
            <div>
                <button type="button" className="create-session btn btn-outline-warning" onClick={toggleMakeRoom}>
                    방 만들기
                </button>
                <button className="find-session btn btn-outline-info" onClick={toggleFindRoom}>코드로 찾기</button>
            </div>

            {makeRoomVisible && ( //true면 모달 렌더링 해줌
                <div className={styles['modal-overlay']}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h1>방 만들기 </h1>
                                <button type="button" className="btn-close" onClick={toggleMakeRoom}></button>
                            </div>
                            <div className="modal-body">
                                <form action="/create-room" method="POST">
                                    <input name="title" type="text" placeholder="방 이름" className="form-control" />
                                    <button type="submit" className="btn btn-primary btn-lg mt-3">방 만들기</button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {findRoomVisible && ( //true면 모달 렌더링 해줌
                <div className={styles['modal-overlay']}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h1>코드로 접속 </h1>
                                <button type="button" className="btn-close" onClick={toggleFindRoom}></button>
                            </div>
                            <div className="modal-body">
                                <form action={`/battle/${roomCode}`} method="POST">
                                    <input name="code" type="number" placeholder="방 코드 ( 4자리 숫자 )" className="form-control" onChange={handleRoomCodeChange} />
                                    <button type="submit" className="btn btn-primary btn-lg mt-3">방 찾기</button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div id="room-list">
                {rooms.map((room, index) => (   //키 넣는거 까먹
                    <div key={index}>   
                        <h3>{room.title}</h3>
                        <span>{room.nickname}</span>
                    </div> 
                ))}
            </div>
        </div>
    );
}

export default Match;
