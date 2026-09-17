import { z } from 'zod';

export const quoteSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  rut: z.string().trim().min(7).max(20),
  telefono: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(160),
  region: z.string().trim().min(2).max(80),
  comuna: z.string().trim().min(2).max(80),
  tipo_servicio: z.string().trim().min(2).max(120),
  servicio_origen: z.string().trim().max(120).optional().default(''),
  fecha_visita: z.string().trim().max(10).optional().default(''),
  horario: z.string().trim().max(30).optional().default(''),
  detalle: z.string().trim().max(2000).optional().default(''),
  website: z.string().trim().max(0).optional().default(''),
});
