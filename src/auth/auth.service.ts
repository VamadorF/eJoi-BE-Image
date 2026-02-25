import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
    ) { }

    async authUserLogin(data: AuthDto): Promise<object> {
        const { email, password } = data;

        // Here you would typically fetch the user from the database and verify the password
        // For demonstration purposes, we will assume the user exists and the password is correct.
        const id = 1; // This should be replaced with actual user ID retrieval logic
        const name = 'John Doe'; // This should be replaced with actual user name retrieval logic

        return {
            code: 200,
            access_token: this.jwtService.sign({
                id,
                name,
                email,
            }),
        };
    }
}