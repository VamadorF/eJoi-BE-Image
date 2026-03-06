import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

@Injectable()
export class StorageService {
    private readonly storage: Storage;
    private readonly bucketName: string;

    constructor(private readonly config: ConfigService) {
        const projectId = this.config.get<string>("GCP_PROJECT_ID");
        const clientEmail = this.config.get<string>("GCP_CLIENT_EMAIL");
        const privateKey = this.config
            .get<string>("GCP_PRIVATE_KEY")
            ?.replace(/\\n/g, "\n");

        this.bucketName = this.config.get<string>("GCS_BUCKET_NAME")!;

        this.storage = new Storage({
            projectId,
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
        });
    }

    async uploadImage(params: {
        buffer: Buffer;
        contentType: string;
        companionId: string;
        ext: "png" | "jpeg" | "webp";
    }) {

        console.log(`UploadImage:Uploading image for companionId ${params.companionId} with contentType ${params.contentType}`);

        if (!params.buffer || !params.contentType) {
            throw new Error("Buffer and contentType are required for upload");
        }

        const filename = `${params.companionId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${params.ext}`;
        const bucket = this.storage.bucket(this.bucketName);
        const file = bucket.file(filename);

        console.log(`Uploading image to ${this.bucketName}/${filename} with contentType ${params.contentType}`);

        await file.save(params.buffer, {
            contentType: params.contentType,
            resumable: false,
            metadata: {
                contentType: params.contentType,
            },
        });

        return {
            filename,
            storagePath: filename,
        };
    }

    async getSignedReadUrl(storagePath: string, expiresInMinutes = 60) {
        const bucket = this.storage.bucket(this.bucketName);
        const file = bucket.file(storagePath);

        const [url] = await file.getSignedUrl({
            version: "v4",
            action: "read",
            expires: Date.now() + expiresInMinutes * 60 * 1000,
        });

        return url;
    }

    getPublicUrl(storagePath: string) {
        return `https://storage.googleapis.com/${this.bucketName}/${storagePath}`;
    }
}