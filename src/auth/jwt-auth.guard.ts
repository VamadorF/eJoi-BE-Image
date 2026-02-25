import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  // This guard will use the JWT strategy to authenticate requests
  // Additional logic can be added here if needed
}