import { getDb } from "@hilihili/db";

// Drizzle 实例：schema 已通过 getDb() 内部 drizzle(getSqlite(), { schema }) 注入，
// 行类型从 schema 推导，消除裸 SQL 字段名与 schema 脱节的风险。
export const db = getDb();
