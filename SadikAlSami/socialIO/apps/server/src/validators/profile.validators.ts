import { z } from "zod";

import { profileSelectSchema, profileUpdateSchema } from "@socialIO/db/validators/profile.validators";

export const profileResponseSchema = profileSelectSchema;

export const updateProfileBodySchema = profileUpdateSchema
	.pick({ displayName: true, bio: true })
	.superRefine((data, ctx) => {
		if (!data.displayName && !data.bio) {
			ctx.addIssue({
				code: "custom",
				message: "displayName or bio is required",
				path: ["displayName"],
			});
		}
	});

export const updateProfileAvatarBodySchema = profileUpdateSchema
	.pick({ avatarUrl: true })
	.superRefine((data, ctx) => {
		if (!data.avatarUrl) {
			ctx.addIssue({
				code: "custom",
				message: "avatarUrl is required",
				path: ["avatarUrl"],
			});
		}
	});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
export type UpdateProfileAvatarBody = z.infer<typeof updateProfileAvatarBodySchema>;
