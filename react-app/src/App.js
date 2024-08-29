import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./routes/Home.js"
import Match from "./routes/Match.js";
//import 'bootstrap/dist/css/bootstrap.min.css';  //리액트 전체페이지에 부트스트랩 적용(모듈화해서 버튼만 가져오고 이런게 아니라 좀 부담될수도)


function App() {
  return (
    <Router basename="/react">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/match" element={<Match />} />
      </Routes>
    </Router>
  );
}

export default App;
