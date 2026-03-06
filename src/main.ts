import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Server is running on http://localhost:${port}`);
}

bootstrap();
