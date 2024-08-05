import { DataSource } from "typeorm";
import { TransactedRepository } from "./transacted-repository";
import { MysqlConnectionOptions } from "typeorm/driver/mysql/MysqlConnectionOptions";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import { CockroachConnectionOptions } from "typeorm/driver/cockroachdb/CockroachConnectionOptions";
import { SqliteConnectionOptions } from "typeorm/driver/sqlite/SqliteConnectionOptions";

import { SqlServerConnectionOptions } from "typeorm/driver/sqlserver/SqlServerConnectionOptions";
import { OracleConnectionOptions } from "typeorm/driver/oracle/OracleConnectionOptions";
import { MongoConnectionOptions } from "typeorm/driver/mongodb/MongoConnectionOptions";
import { CordovaConnectionOptions } from "typeorm/driver/cordova/CordovaConnectionOptions";
import { SqljsConnectionOptions } from "typeorm/driver/sqljs/SqljsConnectionOptions";
import { ReactNativeConnectionOptions } from "typeorm/driver/react-native/ReactNativeConnectionOptions";
import { NativescriptConnectionOptions } from "typeorm/driver/nativescript/NativescriptConnectionOptions";
import { ExpoConnectionOptions } from "typeorm/driver/expo/ExpoConnectionOptions";
import { AuroraMysqlConnectionOptions } from "typeorm/driver/aurora-mysql/AuroraMysqlConnectionOptions";
import { SapConnectionOptions } from "typeorm/driver/sap/SapConnectionOptions";
import { AuroraPostgresConnectionOptions } from "typeorm/driver/aurora-postgres/AuroraPostgresConnectionOptions";
import { BetterSqlite3ConnectionOptions } from "typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions";
import { CapacitorConnectionOptions } from "typeorm/driver/capacitor/CapacitorConnectionOptions";
import { SpannerConnectionOptions } from "typeorm/driver/spanner/SpannerConnectionOptions";

export type TransactedDataSourceOptions =
  | MysqlConnectionOptions
  | PostgresConnectionOptions
  | CockroachConnectionOptions
  | SqliteConnectionOptions
  | SqlServerConnectionOptions
  | SapConnectionOptions
  | OracleConnectionOptions
  | CordovaConnectionOptions
  | NativescriptConnectionOptions
  | ReactNativeConnectionOptions
  | SqljsConnectionOptions
  | MongoConnectionOptions
  | AuroraMysqlConnectionOptions
  | AuroraPostgresConnectionOptions
  | ExpoConnectionOptions
  | BetterSqlite3ConnectionOptions
  | CapacitorConnectionOptions
  | SpannerConnectionOptions;
export class TransactedDataSource extends DataSource {
  constructor(options: TransactedDataSourceOptions) {
    super(options);
  }

  async getTransactionalRepository(target: any, request: any): Promise<any> {
    return new TransactedRepository(target, request);
  }
}
