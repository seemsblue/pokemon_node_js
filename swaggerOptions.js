// swaggerOptions.js

const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API 정리",
      version: "1.0.0",
      description: "API documentation for my PNJ!!",
    },
    servers: [
      {
        url: "http://localhost:3000", // API 서버 URL
      },
    ],
  },
  apis: ["./routes/*.js", './server.js'], // 라우터 파일들이 있는 디렉토리 경로 + sever파일도 추가!!!!!!!!
};

// swagger-jsdoc으로 Swagger 스펙 생성
const specs = swaggerJSDoc(options);

// swagger-ui-express와 specs를 함께 내보내기
module.exports = {
  swaggerUi,
  specs,
};
