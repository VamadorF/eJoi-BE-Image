import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    NotImplementedException,
    Post,
    UseGuards,
} from '@nestjs/common';
import { AuthDto } from 'src/auth/dto/auth.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @UseGuards(JwtAuthGuard)
    @Get()
    @HttpCode(200)
    async estadoDeAutenticado() {
        return { code: 200, status: 'ok' }
    }

    @Post()
    async createCliente(@Body() data: AuthDto): Promise<object> {
        return this.authService.authUserLogin(data);
    }
}