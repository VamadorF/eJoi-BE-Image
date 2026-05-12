import { IsString, IsNotEmpty } from 'class-validator';

export class GenerateImageWithFileDto {
  @IsString()
  @IsNotEmpty()
  prompt: string;
}

