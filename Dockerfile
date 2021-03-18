FROM node:14.16-alpine@sha256:a75f7cc536062f9266f602d49047bc249826581406f8bc5a6605c76f9ed18e98

RUN apk add --no-cache tini

ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /home/node/app

COPY package.json package-lock.json /home/node/app/

RUN chown -R node /home/node && \
	apk add --no-cache --virtual .build-deps && \
	npm install --quiet && \
	npm cache clean --force && \
	apk del .build-deps

COPY . /home/node/app

USER node

CMD ["npm", "test"]
