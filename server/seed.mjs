import "./config.mjs";
import { db, dbPath, seeded } from "./db.mjs";

const users = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
const courses = db.prepare("SELECT COUNT(*) AS count FROM courses").get().count;
const assignments = db.prepare("SELECT COUNT(*) AS count FROM assignments").get().count;

console.log(`[知澜智慧校园] 数据库：${dbPath}`);
console.log(
  seeded
    ? "[知澜智慧校园] 已写入初始演示数据"
    : "[知澜智慧校园] 数据库已有用户，未重复写入初始数据"
);
console.log(
  `[知澜智慧校园] 当前数据：${users} 个用户，${courses} 门课程，${assignments} 项作业`
);

db.close();
