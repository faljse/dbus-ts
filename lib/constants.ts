  enum MessageType {
    invalid= 0,
    methodCall= 1,
    methodReturn= 2,
    error= 3,
    signal= 4
  }

  enum headerTypeName {
    null, 'path', 'interface', 'member',
    'errorName', 'replySerial', 'destination',
    'sender', 'signature'
  }

  // TODO: merge to single hash? e.g path -> [1, 'o']
  enum fieldSignature {
    path = 'o',
    'interface'= 's',
    member= 's',
    errorName= 's',
    replySerial= 'u',
    destination= 's',
    sender= 's',
    signature= 'g'
  }

  enum headerTypeId {
    path= 1,
    'interface'= 2,
    member= 3,
    errorName= 4,
    replySerial= 5,
    destination= 6,
    sender= 7,
    signature= 8
  }
  const protocolVersion= 1;

  enum flags {
    noReplyExpected= 1,
    noAutoStart= 2
  }
  
  enum endianness {
    le= 108,
    be= 66
  }

  const messageSignature = 'yyyyuua(yv)';
  const defaultAuthMethods = ['EXTERNAL', 'DBUS_COOKIE_SHA1', 'ANONYMOUS'];
