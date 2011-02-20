var http = require('http');

// Proxy that rewrites webpages
//
// engage with:
// sudo iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080 -m owner '!' --uid-owner nobody
// sudo -u nobody node rotating-proxy.js

var replaces = {
  // Maps strings to items to replace
  '<body': function(){
    // CSS3 transform: rotate & scale by a small amount
    var effect = (Math.random() < 0.05?
                     'rotate('+(2*Math.random()-1)+'deg) '
                   : 'rotate('+[90, 180, 270][parseInt(Math.random()*3, 10)]+'deg)') +
                 'scale('+(1 + 0.2*(Math.random()-0.5))+')';
    return '<body style="-moz-transform: '+effect+'; -webkit-transform: '+effect+';"';
  },
  '</body>': function(){
    // Draw a few random graphical glitches
    function makeGlitch() {
      var top=Math.random()*2500,
          left=(Math.random()-0.5)*1280,
          height=Math.random()*200,
          opacity=Math.random()*0.3,
          color="0123456789abcdef"[parseInt(Math.random()*16, 10)] +
                "0123456789abcdef"[parseInt(Math.random()*16, 10)] +
                "0123456789abcdef"[parseInt(Math.random()*16, 10)];
        
      return ('<div style="position: fixed; z-index: 10000; '+
              'top: '+top+'px'+
            '; left: '+left+'px'+
            '; width: 100%'+
            '; height: '+height+'px'+
            '; background-color: #'+color+
            '; opacity: '+opacity+
            ';">&nbsp;</div>');
    }

    var replacement="";
    while (Math.random() < 0.5) {
      replacement+=makeGlitch();
    }
    return replacement+'</body>';
  }
};

http.createServer(function(proxiedReq, proxiedRes) {
  // when clients send us requests
  delete proxiedReq.headers['accept-encoding']; // turn off gzip
  // make the outgoing connection
  var newClient = http.createClient(80, proxiedReq.headers.host),
      newReq = newClient.request(proxiedReq.method, proxiedReq.url, proxiedReq.headers);

  newClient.addListener('error', function(error) {
    console.log(error);
    console.log(error.stack);
  });
  proxiedReq.connection.setMaxListeners(15);
  proxiedReq.connection.addListener('error', function(error) {
    console.log(error);
    console.log(error.stack);
  });

  newReq.addListener('response', function(newRes) {
    // when the server (the website the client is browsing to) gives us our
    // response

    // is this an HTML page? we should only replace HTML pages.
    var html=(newRes.headers['content-type'] && 
              newRes.headers['content-type']
                .toLowerCase()
                .indexOf("html") != -1),
        buffer = "";
    newRes.addListener('error', function(error) {
      console.log(error);
      console.log(error.stack);
    });
    newRes.addListener('data', function(chunk) {
      if (html) {
        // potentially store in a string and rewrite
        buffer += chunk.toString('utf-8'); // <-- TODO coercing to a string is the wrong thing to do
      } else {
        // binary data, just pass it through
        proxiedRes.write(chunk, 'binary');
      }
    });
    newRes.addListener('end', function() {
      if (html) {
        for (var key in replaces) {
          if (replaces.hasOwnProperty(key)) {
            var result = typeof replaces[key]=='function'?
                           replaces[key]()
                         : replaces[key];
            buffer = buffer.replace(key, result);
          }
        }
        proxiedRes.end(buffer);
      } else {
        proxiedRes.end();
      }
    });
    // pass headers on to the client
    delete newRes.headers['content-length'];
    proxiedRes.writeHead(newRes.statusCode, newRes.headers);
  });

  newReq.addListener('data', function(chunk) {
    // when the client sends data, pass it through
    proxiedRes.write(chunk, 'binary');
  });

  newReq.addListener('end', function() {
    // when the client ends, go away
    proxiedRes.end();
  });

  newReq.end();
}).listen(8080);
