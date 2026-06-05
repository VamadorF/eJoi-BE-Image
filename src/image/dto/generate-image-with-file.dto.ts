import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';
export type ImageQuality = 'standard' | 'hd';
export type ImageStyle = 'vivid' | 'natural';

export class GenerateImageWithFileDto {
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  companionId?: string;

  @IsOptional()
  @IsString()
  uuid?: string;

  @IsOptional()
  @IsEnum(['1024x1024', '1792x1024', '1024x1792'])
  size?: ImageSize = '1024x1024';

  @IsOptional()
  @IsEnum(['standard', 'hd'])
  quality?: ImageQuality = 'standard';

  @IsOptional()
  @IsEnum(['vivid', 'natural'])
  style?: ImageStyle = 'vivid';

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @IsOptional()
  @IsEnum(['1:1', '4:3', '3:4', '9:16', '16:9'])
  aspectRatio?: '1:1' | '4:3' | '3:4' | '9:16' | '16:9';
}

