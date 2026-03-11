import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): object {
    return { message: 'Hello IA Images!', status: 'success', data: null, error: null, code: 200 };
  }
}
