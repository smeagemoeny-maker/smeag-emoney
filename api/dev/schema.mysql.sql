-- Local test copy of the smeagemoney tables the POS/office screens use.
-- Columns match the production MySQL database (see DBSQL/*.sql and smeagemoney_schema.sql).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `mgperson` (
  `id` int NOT NULL AUTO_INCREMENT,
  `login_id` varchar(50) NOT NULL,
  `password` varchar(64) DEFAULT NULL,
  `name` varchar(50) DEFAULT NULL,
  `position` varchar(100) NOT NULL,
  `campus` varchar(100) NOT NULL,
  `register_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `person` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uid` varchar(20) NOT NULL,
  `studentid` varchar(50) DEFAULT NULL,
  `name` varchar(100) DEFAULT NULL,
  `photo` varchar(255) DEFAULT NULL,
  `age` int DEFAULT NULL,
  `gender` varchar(100) DEFAULT NULL,
  `campus` varchar(100) DEFAULT NULL,
  `s_date` date NOT NULL,
  `e_date` date NOT NULL,
  `totalmoney` decimal(10,2) DEFAULT '0.00',
  `register_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `uid` (`uid`)
);

CREATE TABLE IF NOT EXISTS `store_menus` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Campus` varchar(50) NOT NULL,
  `m_menu` varchar(100) DEFAULT NULL,
  `s_menu` varchar(100) DEFAULT NULL,
  `image_path` varchar(255) DEFAULT NULL,
  `payment` decimal(10,2) NOT NULL,
  `stock` int NOT NULL DEFAULT '0',
  `sales_number` int NOT NULL DEFAULT '0',
  `min_stock` int NOT NULL DEFAULT '5',
  `manager` varchar(100) DEFAULT NULL,
  `register_date` datetime DEFAULT (now()),
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `office_menus` (
  `id` int NOT NULL AUTO_INCREMENT,
  `Campus` varchar(100) NOT NULL,
  `m_menu` varchar(100) DEFAULT NULL,
  `s_menu` varchar(100) DEFAULT NULL,
  `payment` decimal(10,2) NOT NULL,
  `register_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `bank` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `uid` varchar(20) NOT NULL,
  `studentid` varchar(20) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `campus` varchar(50) DEFAULT NULL,
  `beforeamount` decimal(10,2) DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  `subcategory` varchar(120) DEFAULT NULL,
  `transaction_type` varchar(100) NOT NULL,
  `payment` decimal(10,2) DEFAULT NULL,
  `totalmoney` decimal(10,2) DEFAULT '0.00',
  `quantity` int DEFAULT NULL,
  `picture` varchar(255) DEFAULT NULL,
  `transaction_date` datetime DEFAULT (now()),
  `remark` varchar(50) DEFAULT NULL,
  `transaction_source` varchar(20) DEFAULT 'office',
  `order` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `uid` (`uid`),
  KEY `transaction_date` (`transaction_date`)
);

CREATE TABLE IF NOT EXISTS `PusanmartPayments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nfcid` varchar(100) NOT NULL,
  `center` varchar(100) NOT NULL,
  `name` varchar(100) NOT NULL,
  `allpayments` decimal(10,2) NOT NULL DEFAULT '0.00',
  `stock` int NOT NULL DEFAULT '0',
  `register_days` datetime NOT NULL,
  PRIMARY KEY (`id`)
);
