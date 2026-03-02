import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';
export type ImageQuality = 'standard' | 'hd';
export type ImageStyle = 'vivid' | 'natural';

export class GenerateImageDto {
    @IsString()
    @IsNotEmpty()
    prompt: string;

    @IsOptional()
    @IsEnum(['1024x1024', '1792x1024', '1024x1792'])
    size?: ImageSize = '1024x1024';

    @IsOptional()
    @IsEnum(['standard', 'hd'])
    quality?: ImageQuality = 'standard';

    @IsOptional()
    @IsEnum(['vivid', 'natural'])
    style?: ImageStyle = 'vivid';
}