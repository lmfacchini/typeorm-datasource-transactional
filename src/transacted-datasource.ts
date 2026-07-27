import { DataSource, DataSourceOptions } from "typeorm";
import { TransactedRepository } from "./transacted-repository";

export type TransactedDataSourceOptions = DataSourceOptions;
export class TransactedDataSource extends DataSource {
  constructor(options: TransactedDataSourceOptions) {
    super(options);
  }

  async getTransactionalRepository(target: any, request: any): Promise<any> {
    return new TransactedRepository(target, request);
  }
}
