ALTER TABLE "Member" ADD COLUMN "username" TEXT;

UPDATE "Member"
SET "username" = "User"."githubLogin"
FROM "User"
WHERE "Member"."userId" = "User"."id";

ALTER TABLE "Member" ALTER COLUMN "username" SET NOT NULL;

DROP INDEX "Member_displayName_key";

CREATE UNIQUE INDEX "Member_username_key" ON "Member"("username");
