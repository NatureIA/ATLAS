using System.ComponentModel.DataAnnotations;

namespace Atlas.Domain;

// Device-specific opt-in, not financial or login data.
public sealed class PushDeviceSubscription {
    public long Id { get; set; }
    public int UserId { get; set; }
    public string EndpointHash { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastNotifiedUtc { get; set; }
    public DateTime? LastDisplayedUtc { get; set; }
    public DateTime? LastNotifiedDay { get; set; }
    public int? LastNotifiedSlot { get; set; }
}

public sealed class PushSubscriptionInput {
    [Required, MaxLength(2048)] public string Endpoint { get; set; } = "";
    [Required, MaxLength(512)] public string P256dh { get; set; } = "";
    [Required, MaxLength(256)] public string Auth { get; set; } = "";
}

public sealed class PushRemoveInput {
    [Required, MaxLength(2048)] public string Endpoint { get; set; } = "";
}

public sealed class PushReceiptInput {
    public long DeviceId { get; set; }
    public string Day { get; set; } = "";
    public int Slot { get; set; }
    public string Token { get; set; } = "";
}
