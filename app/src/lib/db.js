'use strict';

const mysql = require('mysql2/promise');
const { db } = require('../config');

const pool = mysql.createPool({
  ...db,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'local',
  // Las columnas DATE llegan como 'AAAA-MM-DD' para no desplazarlas por zona horaria
  dateStrings: ['DATE'],
  decimalNumbers: true,
  charset: 'utf8mb4',
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function transaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Espera a que MariaDB acepte conexiones (útil al arrancar con Docker). */
async function esperarConexion(intentos = 30) {
  for (let i = 1; i <= intentos; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      if (i === intentos) throw e;
      console.log(`Esperando base de datos (${i}/${intentos})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

module.exports = { pool, query, transaccion, esperarConexion };
