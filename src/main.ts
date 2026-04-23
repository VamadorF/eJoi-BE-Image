import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilitar CORS para permitir solicitudes desde cualquier origen
  // Si deseas restringir los orígenes permitidos, puedes configurar CORS de la siguiente manera:
  /*
  app.enableCors({
    origin: 'http://example.com', // Reemplaza con el dominio permitido
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  */
 
  app.enableCors(); // 👈 Esto habilita CORS global

  // Configuración de Swagger
  const config = new DocumentBuilder()
    .setTitle('EJOI-BE IMAGE API')
    .setDescription('API para la generacion de imagenes de eJoi.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);


  const port = Number(process.env.PORT) || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Server is running on http://localhost:${port}`);
}

bootstrap();
