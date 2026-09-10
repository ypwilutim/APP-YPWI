const db = require('./db');

async function migrate() {
  try {
    await db.runMultiple(`CREATE TABLE IF NOT EXISTS employment_rules (id int NOT NULL AUTO_INCREMENT, job_title_pattern varchar(100) NOT NULL, employment_type enum('PTY','PTTY','GTY','GTTY') NOT NULL, min_years int NOT NULL DEFAULT 0, max_years int NOT NULL DEFAULT 2, PRIMARY KEY (id), UNIQUE KEY unique_title (job_title_pattern)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.runMultiple(`CREATE TABLE IF NOT EXISTS employment_status_rules (id int NOT NULL AUTO_INCREMENT, employment_type enum('PTY','PTTY','GTY','GTTY') NOT NULL, min_years int NOT NULL, max_years int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.runMultiple(`INSERT IGNORE INTO employment_rules (job_title_pattern, employment_type, min_years, max_years) VALUES ('Admin','PTTY',0,2),('TU','PTTY',0,2),('Tata Usaha','PTTY',0,2),('Operator','PTTY',0,2),('Pimpinan Pondok','PTTY',0,2),('Pimpinan','PTTY',0,2),('Ketua','PTY',2,100),('Wakasek','PTY',2,100),('Kepala Sekolah','GTY',2,100),('Bendahara','PTTY',0,2),('Media','PTTY',0,2),('Guru Mapel','GTY',2,100),('Guru Mengaji','GTY',2,100),('Wali Kelas','GTY',2,100),('Walikelas','GTY',2,100),('Guru','GTY',2,100),('Muhaffiz','GTY',2,100),('Muhaffizah','GTY',2,100),('Security','PTTY',0,2),('Cleaning Service','PTTY',0,2),('Bag. Dapur','PTTY',0,2),('Bag. Kantin','PTTY',0,2)`);
    await db.runMultiple(`INSERT IGNORE INTO employment_status_rules (employment_type, min_years, max_years) VALUES ('PTY',2,100),('PTTY',0,2),('GTY',2,100),('GTTY',0,2)`);
    console.log('Migration complete');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

migrate();